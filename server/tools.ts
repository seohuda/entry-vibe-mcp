import { existsSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { compileProject, CompileError } from '../compiler/compile.ts';
import { auditCompiledProject } from '../compiler/audit-export.ts';
import { decompileProject } from '../compiler/decompile.ts';
import { prepareExport, writePreparedOutputs } from '../compiler/pack.ts';
import { smokeTestProject } from '../compiler/smoke.ts';
import { simulateProject } from '../compiler/runtime-sim.ts';
import { verifyProject } from '../compiler/verify.ts';
import { unpackEnt, resolveEntPath } from '../compiler/unpack.ts';
import { validateProject } from '../compiler/validate.ts';
import { diffProjects } from '../compiler/diff.ts';
import { repairProject } from '../compiler/repair.ts';
import type { EntryIR, EntryIRLearning, EntryIRObject, EntryIRScene, Thread } from '../src/types/ir.ts';
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
  addSceneValidated,
  IREditError,
  patchObjectValidated,
  patchScriptValidated,
  removeObjectValidated,
  removeSceneValidated,
  setLearningValidated,
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

const irLearningSchema = z.object({
  type: z.enum([
    'image',
    'speech',
    'text',
    'number',
    'regression',
    'logisticRegression',
    'cluster',
    'decisiontree',
    'svm',
  ]),
  labels: z.array(z.string()).min(1),
  id: z.string().optional(),
  _id: z.string().optional(),
  url: z.string().optional(),
  name: z.string().optional(),
  model: z.string().optional(),
  version: z.number().optional(),
  recordTime: z.number().optional(),
  trainParam: z.record(z.union([z.string(), z.number()])).optional(),
  tableData: z
    .record(z.unknown())
    .nullable()
    .optional()
    .describe('Optional Entry dataTable (columns/records) for the trained model'),
  modelPath: z
    .string()
    .optional()
    .describe('Optional assets/learning/*.json sidecar merged into project.learning'),
});

const irSceneSchema = z.object({
  name: z.string(),
  background: irPictureSchema.optional(),
});

export const entryIRSchema = z.object({
  scenes: z.array(irSceneSchema).optional(),
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
  learning: irLearningSchema
    .optional()
    .describe('Required when IR uses AI learning blocks (scope=ai)'),
  speed: z.number().positive().optional().describe('Project FPS (default 60)'),
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
    'repair_project',
    {
      description: `Propose deterministic, non-destructive IR repairs. Defaults to dryRun=true and never guesses block types, params, media, or semantic declarations unless allowSemanticAdditions=true. Review changes/remainingErrors, apply repairedIR, then re-validate.\n\n${IR_SCHEMA_DOC}`,
      inputSchema: {
        ir: z.record(z.unknown()).describe('Full EntryIR project to inspect and repair'),
        dryRun: z
          .boolean()
          .optional()
          .describe('Return the proposal without applying it (default true)'),
        allowSemanticAdditions: z
          .boolean()
          .optional()
          .describe('Add missing scenes, variables, lists, and messages (default false)'),
      },
    },
    async ({ ir, dryRun, allowSemanticAdditions }) => {
      try {
        return textResult(
          repairProject(ir, {
            dryRun: dryRun ?? true,
            policy: { allowSemanticAdditions: allowSemanticAdditions ?? false },
          }),
        );
      } catch (err) {
        return errorResult(
          JSON.stringify(
            {
              ok: false,
              errors: [err instanceof Error ? err.message : String(err)],
              hints: ['Inspect the IR shape and retry; repair_project never mutates the input.'],
            },
            null,
            2,
          ),
        );
      }
    },
  );

  server.registerTool(
    'diff_project',
    {
      description: `Compare two EntryIR versions structurally. Returns added/removed/modified changes, per-section summary, media changes, warnings, and truncation info. Set maxChanges to bound each change list (default 200).\n\n${IR_SCHEMA_DOC}`,
      inputSchema: {
        before: entryIRSchema.describe('Baseline EntryIR project'),
        after: entryIRSchema.describe('Updated EntryIR project'),
        maxChanges: z
          .number()
          .int()
          .min(1)
          .max(2000)
          .optional()
          .describe('Max changes per added/removed/modified list (default 200)'),
      },
    },
    async ({ before, after, maxChanges }) =>
      textResult(diffProjects(before, after, { maxChanges })),
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
        await writePreparedOutputs(prepared, {
          entPath,
          jsonPath,
          overwrite: overwrite === true,
        });
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
        // Audit archive members before copying any media into the host assets directory.
        const inspected = await unpackEnt(entPath, { extractMedia: false });
        const exportAudit = auditCompiledProject(inspected.project, {
          tarPaths: inspected.tarPaths,
        });
        if (!exportAudit.ok) {
          return errorResult(
            JSON.stringify(
              {
                ok: false,
                errors: exportAudit.errors,
                hints: exportAudit.hints,
                audit: exportAudit,
              },
              null,
              2,
            ),
          );
        }
        // Only a fully audited archive is allowed to populate assets/imported/.
        const { media } = await unpackEnt(entPath);
        const { ir, warnings } = decompileProject(inspected.project, { media });
        return textResult({
          ok: true,
          ir,
          warnings: warnings.length ? warnings : undefined,
          audit: exportAudit,
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

  server.registerTool(
    'verify_project',
    {
      description: `Full verification: smoke + export shape + pack roundtrip + runtime simulation. Prefer this over smoke_test alone before compile.\n\n${IR_SCHEMA_DOC}`,
      inputSchema: {
        ir: entryIRSchema,
        roundtrip: z.boolean().optional().describe('Run .ent pack/unpack roundtrip (default true)'),
        simulate: z.boolean().optional().describe('Run core block simulator (default true)'),
      },
    },
    async ({ ir, roundtrip, simulate }) =>
      textResult(
        await verifyProject(ir as EntryIR, {
          roundtrip: roundtrip ?? true,
          simulate: simulate ?? true,
        }),
      ),
  );

  server.registerTool(
    'simulate_project',
    {
      description: `Simulate core blocks (move, rotate, variables, repeat) and return predicted entity positions/variables. Not full entryjs — use for automation sanity checks.\n\n${IR_SCHEMA_DOC}`,
      inputSchema: {
        ir: entryIRSchema,
        maxSteps: z.number().int().min(1).max(5000).optional().describe('Max steps (default 500)'),
      },
    },
    async ({ ir, maxSteps }) =>
      textResult(simulateProject(ir as EntryIR, { maxSteps: maxSteps ?? 500 })),
  );

  server.registerTool(
    'remove_object',
    {
      description: `Remove an object by name (must leave at least one object). Returns updated ir + validation.\n\n${IR_SCHEMA_DOC}`,
      inputSchema: {
        ir: entryIRSchema,
        objectName: z.string(),
      },
    },
    async ({ ir, objectName }) => {
      try {
        const result = removeObjectValidated(ir as EntryIR, objectName);
        return textResult({ ok: result.validation.valid, ir: result.ir, validation: result.validation });
      } catch (err) {
        return errorResult(JSON.stringify({ ok: false, errors: [String(err)] }, null, 2));
      }
    },
  );

  server.registerTool(
    'patch_object',
    {
      description: `Patch object fields (x, y, scene, text, scripts, sprite, pictures, …) without rewriting the whole IR.\n\n${IR_SCHEMA_DOC}`,
      inputSchema: {
        ir: entryIRSchema,
        objectName: z.string(),
        patch: irObjectSchema
          .omit({ name: true })
          .partial()
          .describe('Fields to merge onto the object'),
      },
    },
    async ({ ir, objectName, patch }) => {
      try {
        const result = patchObjectValidated(ir as EntryIR, objectName, patch as Partial<EntryIRObject>);
        return textResult({ ok: result.validation.valid, ir: result.ir, validation: result.validation });
      } catch (err) {
        return errorResult(JSON.stringify({ ok: false, errors: [String(err)] }, null, 2));
      }
    },
  );

  server.registerTool(
    'add_scene',
    {
      description: `Append a scene to ir.scenes. Returns updated ir + validation.\n\n${IR_SCHEMA_DOC}`,
      inputSchema: {
        ir: entryIRSchema,
        scene: irSceneSchema,
      },
    },
    async ({ ir, scene }) => {
      try {
        const result = addSceneValidated(ir as EntryIR, scene as EntryIRScene);
        return textResult({ ok: result.validation.valid, ir: result.ir, validation: result.validation });
      } catch (err) {
        return errorResult(JSON.stringify({ ok: false, errors: [String(err)] }, null, 2));
      }
    },
  );

  server.registerTool(
    'remove_scene',
    {
      description: `Remove a scene by name (fails if objects still reference it). Returns updated ir + validation.\n\n${IR_SCHEMA_DOC}`,
      inputSchema: {
        ir: entryIRSchema,
        sceneName: z.string(),
      },
    },
    async ({ ir, sceneName }) => {
      try {
        const result = removeSceneValidated(ir as EntryIR, sceneName);
        return textResult({ ok: result.validation.valid, ir: result.ir, validation: result.validation });
      } catch (err) {
        return errorResult(JSON.stringify({ ok: false, errors: [String(err)] }, null, 2));
      }
    },
  );

  server.registerTool(
    'audit_ent',
    {
      description:
        'Audit an existing .ent file for structural/runtime issues (missing name, bad media paths, dangling function refs, UX hints). Does not modify the file.',
      inputSchema: {
        filename: z.string().describe('Input .ent filename in host cwd'),
      },
    },
    async ({ filename }) => {
      try {
        const entPath = resolveEntPath(filename);
        const { project, tarPaths } = await unpackEnt(entPath, { extractMedia: false });
        const audit = auditCompiledProject(project, { tarPaths });
        return textResult({ ok: audit.ok, audit });
      } catch (err) {
        return errorResult(
          JSON.stringify(
            {
              ok: false,
              errors: [err instanceof Error ? err.message : String(err)],
            },
            null,
            2,
          ),
        );
      }
    },
  );

  server.registerTool(
    'set_learning',
    {
      description: `Set or clear ir.learning (required when using AI learning blocks). Pass learning=null to clear.\n\n${IR_SCHEMA_DOC}`,
      inputSchema: {
        ir: entryIRSchema,
        learning: irLearningSchema.nullable(),
      },
    },
    async ({ ir, learning }) => {
      try {
        const result = setLearningValidated(ir as EntryIR, learning as EntryIRLearning | null);
        return textResult({ ok: result.validation.valid, ir: result.ir, validation: result.validation });
      } catch (err) {
        return errorResult(JSON.stringify({ ok: false, errors: [String(err)] }, null, 2));
      }
    },
  );
}
