/**
 * Phase 4 MCP tool registration tests.
 *
 * Uses an in-process fake McpServer so registration, option defaults, and
 * handler-to-compiler forwarding can be checked without spawning stdio.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTools } from '../server/tools.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = join(ROOT, 'catalog', 'blocks.json');

interface ToolResult {
  content?: Array<{ type?: string; text?: string }>;
  isError?: boolean;
}

type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

interface RegisteredTool {
  config: { inputSchema?: Record<string, unknown> };
  handler: ToolHandler;
}

class FakeMcpServer {
  readonly tools = new Map<string, RegisteredTool>();

  registerTool(
    name: string,
    config: RegisteredTool['config'],
    handler: ToolHandler,
  ): void {
    this.tools.set(name, { config, handler });
  }
}

function registered(server: FakeMcpServer, name: string): RegisteredTool {
  const tool = server.tools.get(name);
  if (!tool) throw new Error(`tool not registered: ${name}`);
  return tool;
}

function parseBody(result: ToolResult): Record<string, unknown> {
  const text = result.content?.[0]?.text;
  if (typeof text !== 'string') {
    throw new Error('tool returned no text content');
  }
  return JSON.parse(text) as Record<string, unknown>;
}

function baseObject(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: '봇',
    sprite: 'entrybot',
    scripts: [[{ type: 'when_run_button_click' }]],
    ...overrides,
  };
}

describe.skipIf(!existsSync(CATALOG))('Phase 4 MCP tools', () => {
  let server: FakeMcpServer;

  beforeAll(() => {
    server = new FakeMcpServer();
    registerTools(server as unknown as McpServer);
  });

  it('registers repair_project and diff_project with their input schemas', () => {
    expect([...server.tools.keys()]).toEqual(
      expect.arrayContaining(['repair_project', 'diff_project']),
    );

    const repairSchema = registered(server, 'repair_project').config.inputSchema;
    expect(Object.keys(repairSchema ?? {})).toEqual(
      expect.arrayContaining(['ir', 'dryRun', 'allowSemanticAdditions']),
    );

    const diffSchema = registered(server, 'diff_project').config.inputSchema;
    expect(Object.keys(diffSchema ?? {})).toEqual(
      expect.arrayContaining(['before', 'after', 'maxChanges']),
    );
  });

  it('repair_project defaults to dryRun and returns a non-mutating proposal', async () => {
    const input = {
      speed: 0,
      objects: [baseObject()],
    };
    const snapshot = structuredClone(input);

    const result = await registered(server, 'repair_project').handler({ ir: input });
    const body = parseBody(result);

    expect(result.isError).toBeUndefined();
    expect(body).toMatchObject({ ok: true, dryRun: true });
    expect(body.changes).toEqual([
      expect.objectContaining({ path: 'speed', action: 'remove' }),
    ]);
    expect(body.repairedIR).not.toHaveProperty('speed');
    expect(input).toEqual(snapshot);
  });

  it('repair_project forwards dryRun and allowSemanticAdditions', async () => {
    const input = {
      objects: [
        {
          name: '봇',
          sprite: 'entrybot',
          scene: '게임',
          scripts: [[{ type: 'when_run_button_click' }]],
        },
      ],
    };

    const body = parseBody(
      await registered(server, 'repair_project').handler({
        ir: input,
        dryRun: false,
        allowSemanticAdditions: true,
      }),
    );

    expect(body).toMatchObject({ ok: true, dryRun: false });
    expect(body.changes).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'scenes[1]' })]),
    );
    expect(body.repairedIR).toMatchObject({
      scenes: [{ name: '장면 1' }, { name: '게임' }],
    });
  });

  it('repair_project returns a structured failure for malformed IR', async () => {
    const result = await registered(server, 'repair_project').handler({
      ir: { objects: [] },
    });
    const body = parseBody(result);

    expect(result.isError).toBeUndefined();
    expect(body).toMatchObject({ ok: false, dryRun: true });
    expect(body.remainingErrors).toEqual(['ir.objects must be a non-empty array']);
  });

  it('diff_project forwards the result and reports modified fields', async () => {
    const before = { objects: [baseObject()] };
    const after = { objects: [baseObject({ x: 10 })] };

    const body = parseBody(
      await registered(server, 'diff_project').handler({ before, after }),
    );

    expect(body.modified).toEqual([
      expect.objectContaining({
        path: 'objects.봇.x',
        kind: 'modified',
        after: 10,
      }),
    ]);
    expect(body.summary).toMatchObject({
      modified: 1,
      objects: { modified: 1 },
    });
  });

  it('diff_project forwards maxChanges', async () => {
    const after = {
      objects: [
        { name: 'a', scripts: [] },
        { name: 'b', scripts: [] },
        { name: 'c', scripts: [] },
      ],
    };

    const body = parseBody(
      await registered(server, 'diff_project').handler({
        before: { objects: [] },
        after,
        maxChanges: 1,
      }),
    );

    expect(body.added).toHaveLength(1);
    expect(body.summary).toMatchObject({ added: 3 });
    expect(body.omitted).toBe(2);
    expect(body.truncated).toBe(true);
  });
});
