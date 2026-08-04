import { existsSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { compileProject, CompileError } from '../compiler/compile.ts';
import { packEnt, writeProjectJson } from '../compiler/pack.ts';
import { validateProject } from '../compiler/validate.ts';
import type { EntryIR } from '../src/types/ir.ts';
import { outputDir } from '../src/paths.ts';
import {
  assertCatalogPresent,
  getBlockSchemas,
  listCategories,
  searchBlocks,
  summarizeBlock,
} from './catalog-api.ts';
import { IR_SCHEMA_DOC } from './ir-docs.ts';

const irBlockSchema: z.ZodType<unknown> = z.lazy(() =>
  z.object({
    type: z.string(),
    params: z.record(z.union([z.string(), z.number(), z.boolean(), irBlockSchema])).optional(),
    statements: z.record(z.array(irBlockSchema)).optional(),
  }),
);

export const entryIRSchema = z.object({
  objects: z
    .array(
      z.object({
        name: z.string(),
        sprite: z.literal('entrybot'),
        scripts: z.array(z.array(irBlockSchema)),
      }),
    )
    .min(1),
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
    'list_categories',
    {
      description: `List Entry block categories available in the v1 catalog (AI/hardware excluded).\n\n${IR_SCHEMA_DOC}`,
    },
    async () => textResult({ categories: listCategories() }),
  );

  server.registerTool(
    'search_blocks',
    {
      description: `Search the Entry block catalog by keyword (Korean label or English type). Returns a compact subset — call get_block_schema for full param details before writing IR.\n\n${IR_SCHEMA_DOC}`,
      inputSchema: {
        query: z.string().describe('Search query, e.g. "반복", "move", "bounce", "시작"'),
        category: z
          .string()
          .optional()
          .describe('Optional category filter: start, moving, flow, looks, ...'),
        limit: z.number().int().min(1).max(50).optional().describe('Max results (default 20)'),
      },
    },
    async ({ query, category, limit }) =>
      textResult({ blocks: searchBlocks(query, category, limit ?? 20) }),
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
      description: `Validate an EntryIR object against the catalog without compiling. Fix any errors, then call compile_project.\n\n${IR_SCHEMA_DOC}`,
      inputSchema: {
        ir: entryIRSchema.describe('Full EntryIR project'),
      },
    },
    async ({ ir }) => textResult(validateProject(ir as EntryIR)),
  );

  server.registerTool(
    'compile_project',
    {
      description: `Compile EntryIR into an Entry .ent file (tar.gz with temp/project.json + entrybot media). Writes into the host's working directory. Returns the output path. Fails if the target files already exist — pass overwrite:true to replace them. On failure, returns validation/compile errors — fix IR and retry.\n\n${IR_SCHEMA_DOC}`,
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
                },
                null,
                2,
              ),
            );
          }
        }

        const project = compileProject(ir as EntryIR);
        writeProjectJson(project, jsonPath);
        await packEnt(project, { outputPath: entPath });
        return textResult({
          ok: true,
          entPath,
          projectJsonPath: jsonPath,
          objectCount: project.objects.length,
          message: `Compiled successfully. Open ${entPath} in Entry Offline or upload to playentry.org.`,
        });
      } catch (err) {
        if (err instanceof CompileError) {
          return errorResult(JSON.stringify({ ok: false, errors: err.errors }, null, 2));
        }
        return errorResult(
          JSON.stringify(
            { ok: false, errors: [err instanceof Error ? err.message : String(err)] },
            null,
            2,
          ),
        );
      }
    },
  );
}
