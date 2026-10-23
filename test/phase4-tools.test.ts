/**
 * Phase 4 MCP tool registration tests.
 *
 * Uses an in-process fake McpServer so registration, option defaults, and
 * handler-to-compiler forwarding can be checked without spawning stdio.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as tar from 'tar';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
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

const tempDirs: string[] = [];

function makeHostDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'entry-vibe-audit-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

function auditProjectFixture(fileId: string): Record<string, unknown> {
  const a = fileId.slice(0, 2);
  const b = fileId.slice(2, 4);
  return {
    name: 'sample',
    scenes: [{ id: 'scene-1', name: '장면 1' }],
    objects: [
      {
        name: '봇',
        scene: 'scene-1',
        objectType: 'sprite',
        sprite: {
          pictures: [
            {
              name: '코스튬',
              filename: fileId,
              fileurl: `temp/${a}/${b}/image/${fileId}.svg`,
              thumbUrl: `temp/${a}/${b}/thumb/${fileId}.png`,
            },
          ],
          sounds: [],
        },
      },
    ],
  };
}

async function writeSampleEnt(
  hostDir: string,
  project: unknown,
  media: Array<{ rel: string; body: Buffer }> = [],
  entName = 'sample.ent',
): Promise<void> {
  const staging = join(hostDir, 'staging');
  mkdirSync(join(staging, 'temp'), { recursive: true });
  writeFileSync(join(staging, 'temp', 'project.json'), JSON.stringify(project));
  for (const item of media) {
    const target = join(staging, item.rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, item.body);
  }
  await tar.c({ gzip: true, cwd: staging, file: join(hostDir, entName) }, ['temp']);
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

  it('set_learning preserves tableData values through the tool schema', async () => {
    const tableData = {
      columns: ['x', 'y'],
      records: [
        [1, 2],
        [3, 4],
      ],
    };
    const tool = registered(server, 'set_learning');
    const parsed = z.object(tool.config.inputSchema as z.ZodRawShape).parse({
      ir: { objects: [baseObject()] },
      learning: {
        type: 'number',
        labels: ['고양이', '강아지'],
        tableData,
      },
    });

    const body = parseBody(await tool.handler(parsed));

    expect(body.ok).toBe(true);
    const learning = (body.ir as { learning: Record<string, unknown> }).learning;
    expect(learning.tableData).toEqual(tableData);
  });

  describe('audit_ent hardening', () => {
    async function auditEnt(
      hostDir: string,
    ): Promise<{ body: Record<string, unknown>; result: ToolResult }> {
      const prevCwd = process.cwd();
      const prevAssets = process.env.ENTRY_VIBE_ASSETS_DIR;
      try {
        process.env.ENTRY_VIBE_ASSETS_DIR = join(hostDir, 'assets');
        process.chdir(hostDir);
        const result = await registered(server, 'audit_ent').handler({
          filename: 'sample.ent',
        });
        return { body: parseBody(result), result };
      } finally {
        process.chdir(prevCwd);
        if (prevAssets === undefined) delete process.env.ENTRY_VIBE_ASSETS_DIR;
        else process.env.ENTRY_VIBE_ASSETS_DIR = prevAssets;
      }
    }

    it('reports media missing from the archive and does not create host assets', async () => {
      const hostDir = makeHostDir();
      const fileId = 'f933fb1d1f8c4ad52c413eeb4218f88a';
      await writeSampleEnt(hostDir, auditProjectFixture(fileId));

      const { body, result } = await auditEnt(hostDir);
      expect(result.isError).toBeUndefined();

      const audit = body.audit as { ok: boolean; errors: string[] };
      expect(audit.errors.some((e) => e.includes('is missing from .ent archive'))).toBe(true);
      expect(existsSync(join(hostDir, 'assets'))).toBe(false);
    });

    it('keeps archive media inside the .ent without extracting to host assets', async () => {
      const hostDir = makeHostDir();
      const fileId = '0123456789abcdef0123456789abcdef';
      const a = fileId.slice(0, 2);
      const b = fileId.slice(2, 4);
      await writeSampleEnt(hostDir, auditProjectFixture(fileId), [
        {
          rel: `temp/${a}/${b}/image/${fileId}.svg`,
          body: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>'),
        },
        {
          rel: `temp/${a}/${b}/thumb/${fileId}.png`,
          body: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
        },
      ]);

      const { body, result } = await auditEnt(hostDir);
      expect(result.isError).toBeUndefined();

      const audit = body.audit as { ok: boolean; errors: string[] };
      expect(audit.errors).toEqual([]);
      expect(existsSync(join(hostDir, 'assets'))).toBe(false);
    });
  });

  describe('import_ent hardening', () => {
    async function importEnt(
      hostDir: string,
      filename: string,
    ): Promise<{ body: Record<string, unknown>; result: ToolResult }> {
      const prevCwd = process.cwd();
      const prevAssets = process.env.ENTRY_VIBE_ASSETS_DIR;
      try {
        process.env.ENTRY_VIBE_ASSETS_DIR = join(hostDir, 'assets');
        process.chdir(hostDir);
        const result = await registered(server, 'import_ent').handler({ filename });
        return { body: parseBody(result), result };
      } finally {
        process.chdir(prevCwd);
        if (prevAssets === undefined) delete process.env.ENTRY_VIBE_ASSETS_DIR;
        else process.env.ENTRY_VIBE_ASSETS_DIR = prevAssets;
      }
    }

    it('rejects missing archive media before modifying host assets', async () => {
      const hostDir = makeHostDir();
      const fileId = 'abcdabcdabcdabcdabcdabcdabcdabcd';
      await writeSampleEnt(hostDir, auditProjectFixture(fileId));

      const { body, result } = await importEnt(hostDir, 'sample.ent');
      expect(result.isError).toBe(true);
      expect(body.ok).toBe(false);
      expect((body.errors as string[]).some((e) => e.includes('missing from .ent archive'))).toBe(true);
      expect(existsSync(join(hostDir, 'assets'))).toBe(false);
    });

    it('rejects a re-import whose media bytes conflict with the extracted asset', async () => {
      const hostDir = makeHostDir();
      const fileId = 'aabbccddeeff00112233445566778899';
      const a = fileId.slice(0, 2);
      const b = fileId.slice(2, 4);
      const rel = `temp/${a}/${b}/image/${fileId}.svg`;
      const svgA = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
      );
      const svgB = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><circle cx="5" cy="5" r="5"/></svg>',
      );
      const assetPath = join(hostDir, 'assets', 'imported', `${fileId}.svg`);

      const thumbRel = `temp/${a}/${b}/thumb/${fileId}.png`;
      const thumb = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      await writeSampleEnt(
        hostDir,
        auditProjectFixture(fileId),
        [{ rel, body: svgA }, { rel: thumbRel, body: thumb }],
        'game-a.ent',
      );
      const first = await importEnt(hostDir, 'game-a.ent');
      expect(first.result.isError).toBeUndefined();
      expect(first.body.ok).toBe(true);
      expect(readFileSync(assetPath, 'utf8')).toBe(svgA.toString());

      await writeSampleEnt(
        hostDir,
        auditProjectFixture(fileId),
        [{ rel, body: svgB }, { rel: thumbRel, body: thumb }],
        'game-b.ent',
      );
      const second = await importEnt(hostDir, 'game-b.ent');
      expect(second.result.isError).toBe(true);
      expect(second.body.ok).toBe(false);
      const errors = second.body.errors as string[];
      expect(errors.some((e) => e.includes('media collision'))).toBe(true);
      expect(readFileSync(assetPath, 'utf8')).toBe(svgA.toString());
    });

    it('re-importing the identical archive is idempotent', async () => {
      const hostDir = makeHostDir();
      const fileId = '0123456789abcdef0123456789abcdef';
      const a = fileId.slice(0, 2);
      const b = fileId.slice(2, 4);
      const rel = `temp/${a}/${b}/image/${fileId}.svg`;
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>');
      const assetPath = join(hostDir, 'assets', 'imported', `${fileId}.svg`);

      const thumbRel = `temp/${a}/${b}/thumb/${fileId}.png`;
      const thumb = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      await writeSampleEnt(hostDir, auditProjectFixture(fileId), [
        { rel, body: svg },
        { rel: thumbRel, body: thumb },
      ]);
      const first = await importEnt(hostDir, 'sample.ent');
      const second = await importEnt(hostDir, 'sample.ent');

      expect(first.result.isError).toBeUndefined();
      expect(second.result.isError).toBeUndefined();
      expect(first.body.ok).toBe(true);
      expect(second.body.ok).toBe(true);
      expect(readFileSync(assetPath, 'utf8')).toBe(svg.toString());
    });
  });
});
