import { existsSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { compileProject, CompileError } from '../compiler/compile.ts';
import { decompileProject } from '../compiler/decompile.ts';
import { packPrepared, prepareExport, writePreparedJson } from '../compiler/pack.ts';
import { smokeTestProject } from '../compiler/smoke.ts';
import { unpackEnt, resolveEntPath } from '../compiler/unpack.ts';
import { validateProject } from '../compiler/validate.ts';
import type { EntryIR, EntryIRObject, Thread } from '../src/types/ir.ts';
import { outputDir } from '../src/paths.ts';
import { ensureAssetsDir } from '../compiler/assets.ts';
import {
  assertCatalogPresent,
  getBlockSchemas,
  listCategories,
  searchBlocks,
  summarizeBlock,
  type CatalogScope,
} from './catalog-api.ts';
import { IR_SCHEMA_DOC } from './ir-docs.ts';
import {
  addObjectValidated,
  IREditError,
  patchScriptValidated,
  type PatchScriptMode,
} from './ir-edit.ts';
import { buildGuide } from './recipes.ts';

const catalogScopeSchema = z
  .enum(['core', 'ai', 'hardware', 'all'])
  .optional()
  .describe(
    'Catalog filter. Default core. Use ai for TTS/번역 등, hardware only when a board is named, all to search everything.',
  );

const irBlockSchema: z.ZodType<unknown> = z.lazy(() =>
  z.object({
    type: z.string(),
    params: z.record(z.union([z.string(), z.number(), z.boolean(), irBlockSchema])).optional(),
    statements: z.record(z.array(irBlockSchema)).optional(),
  }),
);

const irPictureSchema = z.object({
  name: z.string().optional(),
  path: z.string().describe('Host path under assets/, png or svg'),
});

const irObjectSchema = z.object({
  name: z.string(),
  kind: z.enum(['sprite', 'text']).optional().describe('Default sprite; use text for text boxes'),
  sprite: z
    .enum(['entrybot', 'custom'])
    .optional()
    .describe('Default entrybot; custom requires pictures[]'),
  text: z.string().optional().describe('Required when kind=text'),
  x: z.number().optional(),
  y: z.number().optional(),
  scene: z.string().optional().describe('Scene name from ir.scenes (default: first scene)'),
  pictures: z.array(irPictureSchema).min(1).optional(),
  sounds: z
    .array(
      z.object({
        name: z.string().optional(),
        path: z.string(),
        duration: z.number().positive().optional(),
      }),
    )
    .min(1)
    .optional(),
  scripts: z.array(z.array(irBlockSchema)),
});

export const entryIRSchema = z.object({
  scenes: z
    .array(
      z.object({
        name: z.string(),
        background: irPictureSchema.optional().describe('Locked background sprite for the scene'),
      }),
    )
    .optional()
    .describe('Scenes; defaults to a single "장면 1" when omitted'),
  objects: z.array(irObjectSchema).min(1),
  variables: z
    .array(
      z.object({
        name: z.string(),
        initialValue: z.union([z.string(), z.number()]),
      }),
    )
    .optional(),
  lists: z
    .array(
      z.object({
        name: z.string(),
        initialValues: z.array(z.union([z.string(), z.number()])).optional(),
      }),
    )
    .optional(),
  messages: z
    .array(z.object({ name: z.string() }))
    .optional()
    .describe('Broadcast signals; reference by name in message_cast VALUE params'),
  functions: z
    .array(
      z.object({
        name: z.string(),
        type: z.enum(['statement', 'string', 'boolean']).optional(),
        body: z.array(irBlockSchema),
        returnValue: z.union([z.string(), z.number(), z.boolean(), irBlockSchema]).optional(),
      }),
    )
    .optional()
    .describe('User functions; call with type function_call and params.NAME'),
});

/**
 * Resolve a caller-supplied filename to a bare `<stem>.ent` name.
 * The value comes from the host LLM, so anything that could escape outputDir()
 * (separators, traversal, absolute paths, NUL) is rejected rather than normalized.
 */
export function safeEntFilename(filename?: string): string {
  const raw = (filename ?? 'entry-project.ent').trim();
  if (!raw) {
    throw new Error('filename must not be empty');
  }
  if (raw.includes('\0') || raw.includes('/') || raw.includes('\\') || basename(raw) !== raw) {
    throw new Error(`filename must be a bare name without any path: ${JSON.stringify(filename)}`);
  }
  const stem = raw.replace(/\.ent$/i, '');
  if (!stem || stem === '.' || stem === '..') {
    throw new Error(`invalid filename: ${JSON.stringify(filename)}`);
  }
  return `${stem}.ent`;
}

/** Which of the given paths already exist (compile_project refuses to clobber these by default). */
export function findOutputConflicts(paths: string[]): string[] {
  return paths.filter((p) => existsSync(p));
}

function textResult(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  };
}

function errorResult(message: string) {
  return {
    content: [{ type: 'text' as const, text: message }],
    isError: true as const,
  };
}

export function registerTools(server: McpServer): void {
  assertCatalogPresent();

  server.registerTool(
    'get_build_guide',
    {
      description: `FIRST tool for any Entry build request. Matches the user's Korean/English request to recipes, recommended blocks, and an IR sketch. Then follow search_blocks → get_block_schema → validate_project → compile_project.\n\n${IR_SCHEMA_DOC}`,
      inputSchema: {
        request: z
          .string()
          .describe('User request in Korean or English, e.g. "고양이 4번 움직이고 벽에 튕기게"'),
      },
    },
    async ({ request }) => textResult(buildGuide(request)),
  );

  server.registerTool(
    'list_categories',
    {
      description: `List Entry block categories. Default scope=core (12 built-in categories). Pass scope=ai|hardware|all when needed.\n\n${IR_SCHEMA_DOC}`,
      inputSchema: {
        scope: catalogScopeSchema,
      },
    },
    async ({ scope }) =>
      textResult({
        scope: (scope ?? 'core') as CatalogScope,
        categories: listCategories((scope ?? 'core') as CatalogScope),
      }),
  );

  server.registerTool(
    'search_blocks',
    {
      description: `Search the Entry block catalog by keyword. Default scope=core so hardware does not drown results. Call get_block_schema before writing IR.\n\n${IR_SCHEMA_DOC}`,
      inputSchema: {
        query: z.string().describe('Search query, e.g. "반복", "move", "bounce", "시작"'),
        category: z
          .string()
          .optional()
          .describe('Optional category filter: start, moving, flow, ai_utilize_tts, ...'),
        limit: z.number().int().min(1).max(50).optional().describe('Max results (default 20)'),
        scope: catalogScopeSchema,
      },
    },
    async ({ query, category, limit, scope }) =>
      textResult({
        scope: (scope ?? 'core') as CatalogScope,
        blocks: searchBlocks(query, category, limit ?? 20, (scope ?? 'core') as CatalogScope),
      }),
  );

  server.registerTool(
    'get_block_schema',
    {
      description: `Get detailed schemas for specific block types (param keys, statementKeys, defaults). Use these exact param/statement keys when building EntryIR.\n\n${IR_SCHEMA_DOC}`,
      inputSchema: {
        types: z
          .array(z.string())
          .min(1)
          .describe(
            'Block type ids, e.g. ["when_run_button_click","repeat_basic","move_direction"]',
          ),
      },
    },
    async ({ types }) => {
      const found = getBlockSchemas(types);
      const missing = types.filter((t) => !found.some((b) => b.type === t));
      return textResult({
        blocks: found.map(summarizeBlock),
        missing: missing.length ? missing : undefined,
      });
    },
  );

  server.registerTool(
    'validate_project',
    {
      description: `Validate EntryIR against the catalog. Returns { valid, errors, hints }. Apply every hint, then re-validate before compile_project.\n\n${IR_SCHEMA_DOC}`,
      inputSchema: {
        ir: entryIRSchema.describe('Full EntryIR project'),
      },
    },
    async ({ ir }) => textResult(validateProject(ir as EntryIR)),
  );

  server.registerTool(
    'compile_project',
    {
      description: `Compile EntryIR into an Entry .ent file (tar.gz) plus matching .json sidecar in the host cwd. On failure returns { ok:false, errors, hints } — fix IR and retry. Pass overwrite:true to replace existing files.\n\n${IR_SCHEMA_DOC}`,
      inputSchema: {
        ir: entryIRSchema.describe('Full EntryIR project'),
        filename: z
          .string()
          .optional()
          .describe('Output filename without path (default entry-project.ent)'),
        overwrite: z
          .boolean()
          .optional()
          .describe('Replace an existing file at the target path (default false)'),
      },
    },
    async ({ ir, filename, overwrite }) => {
      try {
        const name = safeEntFilename(filename);
        const out = outputDir();
        mkdirSync(out, { recursive: true });
        ensureAssetsDir();
        const entPath = join(out, name);
        const jsonPath = join(out, name.replace(/\.ent$/i, '.json'));

        if (!overwrite) {
          const conflicts = findOutputConflicts([entPath, jsonPath]);
          if (conflicts.length > 0) {
            return errorResult(
              JSON.stringify(
                {
                  ok: false,
                  errors: [
                    `refusing to overwrite existing file(s): ${conflicts.join(', ')}. ` +
                      'Pass a different filename, or overwrite: true to replace.',
                  ],
                  hints: [
                    'Use a unique filename, or set overwrite: true if replacing is intentional.',
                  ],
                },
                null,
                2,
              ),
            );
          }
        }

        const project = compileProject(ir as EntryIR);
        const prepared = prepareExport(project);
        writePreparedJson(prepared, jsonPath);
        await packPrepared(prepared, { outputPath: entPath });
        return textResult({
          ok: true,
          entPath,
          projectJsonPath: jsonPath,
          objectCount: project.objects.length,
          name: prepared.project.name,
          message: `Compiled successfully. Open ${entPath} in Entry Offline or upload to playentry.org.`,
        });
      } catch (err) {
        if (err instanceof CompileError) {
          return errorResult(
            JSON.stringify(
              { ok: false, errors: err.errors, hints: err.hints },
              null,
              2,
            ),
          );
        }
        return errorResult(
          JSON.stringify(
            {
              ok: false,
              errors: [err instanceof Error ? err.message : String(err)],
              hints: ['Inspect the error, fix the IR, validate_project, then compile again.'],
            },
            null,
            2,
          ),
        );
      }
    },
  );

  server.registerTool(
    'import_ent',
    {
      description: `Import an existing .ent file from the host cwd into EntryIR (decompile). Extracts bundled media into assets/imported/. Use for read/edit workflows.\n\n${IR_SCHEMA_DOC}`,
      inputSchema: {
        filename: z
          .string()
          .describe('Input .ent filename in host cwd (bare name, e.g. my-project.ent)'),
      },
    },
    async ({ filename }) => {
      try {
        const entPath = resolveEntPath(filename);
        ensureAssetsDir();
        const { project, media } = await unpackEnt(entPath);
        const { ir, warnings } = decompileProject(project, { media });
        return textResult({
          ok: true,
          ir,
          warnings: warnings.length ? warnings : undefined,
          mediaExtracted: media.map((m) => m.assetPath),
          objectCount: ir.objects.length,
          sceneCount: ir.scenes?.length ?? 1,
        });
      } catch (err) {
        return errorResult(
          JSON.stringify(
            {
              ok: false,
              errors: [err instanceof Error ? err.message : String(err)],
              hints: ['Ensure the .ent file exists in the host cwd and is a valid Entry export.'],
            },
            null,
            2,
          ),
        );
      }
    },
  );

  server.registerTool(
    'add_object',
    {
      description: `Incrementally append one object to an existing EntryIR without rewriting the whole project. Returns updated ir + validation.\n\n${IR_SCHEMA_DOC}`,
      inputSchema: {
        ir: entryIRSchema.describe('Current EntryIR project'),
        object: irObjectSchema.describe('Object to append (name must be unique)'),
      },
    },
    async ({ ir, object }) => {
      try {
        const result = addObjectValidated(ir as EntryIR, object as EntryIRObject);
        return textResult({
          ok: result.validation.valid,
          ir: result.ir,
          validation: result.validation,
        });
      } catch (err) {
        return errorResult(
          JSON.stringify(
            {
              ok: false,
              errors: [err instanceof Error ? err.message : String(err)],
              hints: ['Fix the object definition or choose a unique name.'],
            },
            null,
            2,
          ),
        );
      }
    },
  );

  server.registerTool(
    'patch_script',
    {
      description: `Patch one script thread on a named object (replace / append / prepend blocks). Returns updated ir + validation.\n\n${IR_SCHEMA_DOC}`,
      inputSchema: {
        ir: entryIRSchema.describe('Current EntryIR project'),
        objectName: z.string().describe('Target object name'),
        threadIndex: z.number().int().min(0).describe('0-based script thread index'),
        mode: z
          .enum(['replace', 'append', 'prepend'])
          .describe('replace=full thread; append/prepend=blocks only'),
        thread: z.array(irBlockSchema).optional().describe('Required when mode=replace'),
        blocks: z.array(irBlockSchema).optional().describe('Required when mode=append or prepend'),
      },
    },
    async ({ ir, objectName, threadIndex, mode, thread, blocks }) => {
      try {
        const result = patchScriptValidated(ir as EntryIR, {
          objectName,
          threadIndex,
          mode: mode as PatchScriptMode,
          thread: thread as Thread | undefined,
          blocks: blocks as EntryIRObject['scripts'][0] | undefined,
        });
        return textResult({
          ok: result.validation.valid,
          ir: result.ir,
          validation: result.validation,
        });
      } catch (err) {
        return errorResult(
          JSON.stringify(
            {
              ok: false,
              errors: [err instanceof Error ? err.message : String(err)],
              hints: [
                err instanceof IREditError
                  ? 'Check objectName, threadIndex, and mode-specific fields.'
                  : 'Fix the patch and retry.',
              ],
            },
            null,
            2,
          ),
        );
      }
    },
  );

  server.registerTool(
    'smoke_test_project',
    {
      description: `Run structural smoke checks on EntryIR: validate, compile, catalog coverage, scene binding. Use before compile_project in automation loops.\n\n${IR_SCHEMA_DOC}`,
      inputSchema: {
        ir: entryIRSchema.describe('EntryIR project to smoke-test'),
      },
    },
    async ({ ir }) => textResult(smokeTestProject(ir as EntryIR)),
  );
}
