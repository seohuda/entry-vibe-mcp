import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { entryIRSchema, registerTools } from '../server/tools.ts';
import { addLibraryObjectValidated } from '../server/library-api.ts';
import { buildGuide } from '../server/recipes.ts';
import type { EntryIR } from '../src/types/ir.ts';

describe('object library MCP protocol', () => {
  const server = new McpServer({ name: 'entry-library-test', version: '1.0.0' });
  const client = new Client({ name: 'entry-library-test-client', version: '1.0.0' });

  beforeAll(async () => {
    registerTools(server);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client.close();
    await server.close();
  });

  async function call(name: string, args: Record<string, unknown>) {
    const result = await client.callTool({ name, arguments: args });
    const content = result.content as Array<{ type: string; text?: string }>;
    const text = content.find((item) => item.type === 'text')?.text;
    if (!text) throw new Error('tool returned no text');
    return { isError: result.isError === true, data: JSON.parse(text) };
  }

  it('registers all four tools with discoverable schemas', async () => {
    const { tools } = await client.listTools();
    for (const name of ['search_objects', 'get_object_info', 'list_object_categories', 'add_library_object']) {
      expect(tools.find((tool) => tool.name === name)?.description).toBeTruthy();
    }
    const search = tools.find((tool) => tool.name === 'search_objects')!;
    expect(search.inputSchema.properties?.limit).toMatchObject({ maximum: 50 });
    const compile = tools.find((tool) => tool.name === 'compile_project')!;
    expect(JSON.stringify(compile.inputSchema)).toContain('library');
    expect(compile.inputSchema.properties?.ir).toMatchObject({
      properties: { objects: { minItems: 1 } },
    });
  });

  it('searches Korean and English against actual provider metadata', async () => {
    const korean = await call('search_objects', { query: '고양이' });
    const english = await call('search_objects', { query: 'cat', source: 'local' });
    expect(korean.isError).toBe(false);
    expect(korean.data.objects.some((object: { id: string }) => object.id === 'local:cat')).toBe(true);
    expect(english.data.objects.some((object: { id: string }) => object.id === 'local:cat')).toBe(true);
    expect(korean.data.providers.find((provider: { source: string }) => provider.source === 'entry'))
      .toMatchObject({ available: false });
  });

  it('returns categories backed by the same catalog and filters results', async () => {
    const { data } = await call('list_object_categories', { source: 'local' });
    expect(data.categories.length).toBeGreaterThan(0);
    const category = data.categories[0];
    const { data: filtered } = await call('search_objects', { query: '', source: 'local', category: category.id });
    expect(filtered.objects.length).toBe(category.count);
    expect(filtered.objects.every((object: { category: string }) => object.category === category.id)).toBe(true);
  });

  it('provides complete object costumes, sounds, dimensions and licensing', async () => {
    const { data, isError } = await call('get_object_info', { objectId: 'local:cat' });
    expect(isError).toBe(false);
    expect(data.object).toMatchObject({ id: 'local:cat', source: 'local' });
    expect(data.object.costumes.length).toBeGreaterThanOrEqual(2);
    expect(data.object.costumes[0].width).toBeGreaterThan(0);
    expect(data.object.costumes[0].height).toBeGreaterThan(0);
    expect(data.object.license.spdx).toBeTruthy();
    expect(data.object.license.attribution).toBeTruthy();
    expect(Array.isArray(data.object.sounds)).toBe(true);
  });

  it('adds an object to an empty IR and preserves library reference through validation', async () => {
    const { data, isError } = await call('add_library_object', {
      ir: { objects: [], scenes: [{ name: '게임' }] },
      objectId: 'local:cat',
      name: '플레이어', x: -100, y: 50, scene: '게임',
    });
    expect(isError).toBe(false);
    expect(data.ok).toBe(true);
    expect(data.ir.objects[0]).toMatchObject({
      name: '플레이어', sprite: 'library', library: { source: 'local', objectId: 'local:cat' },
      x: -100, y: 50, scene: '게임', scripts: [[{ type: 'when_run_button_click' }]],
    });
    const validation = await call('validate_project', { ir: data.ir });
    expect(validation.data.valid).toBe(true);
    const attributions = [{
      id: data.object.id, source: data.object.source, name: data.object.name,
      license: data.object.license,
    }];
    const patched = await call('patch_object', {
      ir: { ...data.ir, assetAttributions: attributions }, objectName: '플레이어', patch: { x: 20 },
    });
    expect(patched.data.ir.objects[0].library).toEqual({ source: 'local', objectId: 'local:cat' });
    expect(patched.data.ir.assetAttributions).toEqual(attributions);
  });

  it('generates collision-free default names for repeated object imports', async () => {
    const first = await call('add_library_object', { ir: { objects: [] }, objectId: 'local:cat' });
    const second = await call('add_library_object', { ir: first.data.ir, objectId: 'local:cat' });
    expect(second.data.ok).toBe(true);
    expect(new Set(second.data.ir.objects.map((object: { name: string }) => object.name)).size).toBe(2);
    const duplicate = await call('add_library_object', {
      ir: second.data.ir, objectId: 'local:dog', name: first.data.objectName,
    });
    expect(duplicate.isError).toBe(true);
    expect(duplicate.data.errors.join(' ')).toMatch(/already exists/);
  });

  it('compiles a searched and imported object through the public MCP contract', async () => {
    const output = mkdtempSync(join(tmpdir(), 'entry-library-mcp-'));
    const previousOutput = process.env.ENTRY_VIBE_OUTPUT_DIR;
    process.env.ENTRY_VIBE_OUTPUT_DIR = output;
    try {
      const added = await call('add_library_object', { ir: { objects: [] }, objectId: 'local:dog' });
      const compiled = await call('compile_project', { ir: added.data.ir, filename: 'library-dog' });
      expect(compiled.isError).toBe(false);
      expect(compiled.data.ok).toBe(true);
      expect(existsSync(join(output, 'library-dog.ent'))).toBe(true);
      expect(existsSync(join(output, 'library-dog.json'))).toBe(true);
    } finally {
      if (previousOutput === undefined) delete process.env.ENTRY_VIBE_OUTPUT_DIR;
      else process.env.ENTRY_VIBE_OUTPUT_DIR = previousOutput;
      rmSync(output, { recursive: true, force: true });
    }
  });

  it('returns a useful failure for unknown IDs, unavailable providers and unknown scenes', async () => {
    for (const objectId of ['local:does-not-exist', 'entry:made-up-id']) {
      const info = await call('get_object_info', { objectId });
      const add = await call('add_library_object', { ir: { objects: [] }, objectId });
      expect(info.isError).toBe(true);
      expect(add.isError).toBe(true);
      expect(add.data.ok).toBe(false);
      expect(add.data.ir).toBeUndefined();
    }
    const missingScene = await call('add_library_object', {
      ir: { objects: [] }, objectId: 'local:cat', scene: '없는 장면',
    });
    expect(missingScene.data.ok).toBe(false);
    expect(missingScene.data.validation.valid).toBe(false);
    const nativeSearch = await call('search_objects', { query: '고양이', source: 'entry' });
    expect(nativeSearch.isError).toBe(true);
  });
});

describe('library guidance and immutable imports', () => {
  it('keeps build guidance available for requests longer than the search query limit', () => {
    const guide = buildGuide('고양이를 움직여줘. '.repeat(100));
    expect(guide.objectSelection.candidates.some((object) => object.id === 'local:cat')).toBe(true);
    expect(guide.workflow.length).toBeGreaterThan(0);
  });
  it('bounds imported attribution data and rejects non-HTTP license URLs', () => {
    const ir = { objects: [{ name: '텍스트', kind: 'text', text: '안녕', scripts: [] }] };
    const notice = {
      id: 'local:cat', source: 'local', name: '고양이',
      license: { spdx: 'MIT', attribution: 'EntryVibe contributors', url: 'https://example.com/license', text: 'License notice' },
    };
    expect(entryIRSchema.safeParse({ ...ir, assetAttributions: [notice] }).success).toBe(true);
    expect(entryIRSchema.safeParse({ ...ir, assetAttributions: Array(257).fill(notice) }).success).toBe(false);
    expect(entryIRSchema.safeParse({ ...ir, assetAttributions: [{ ...notice, id: 'x'.repeat(201) }] }).success).toBe(false);
    expect(entryIRSchema.safeParse({ ...ir, assetAttributions: [{
      ...notice, license: { ...notice.license, url: 'file:///etc/passwd' },
    }] }).success).toBe(false);
    expect(entryIRSchema.safeParse({ ...ir, assetAttributions: [{
      ...notice, license: { ...notice.license, text: 'x'.repeat(32769) },
    }] }).success).toBe(false);
  });

  it('guides real selection before defaulting to Entrybot', () => {
    const guide = buildGuide('고양이가 걸어가는 애니메이션');
    expect(guide.workflow.findIndex((step) => step.includes('search_objects')))
      .toBeLessThan(guide.workflow.findIndex((step) => step.includes('search_blocks')));
    expect(guide.objectSelection.candidates.some((object) => object.id === 'local:cat')).toBe(true);
    expect(guide.objectSelection.nativeEntry).toContain('미지원');
    expect(guide.agentContract.never.some((rule) => rule.includes('Entrybot'))).toBe(true);
  });

  it('does not mutate input IR and retains metadata as the authority for media', () => {
    const ir: EntryIR = { objects: [] };
    const result = addLibraryObjectValidated(ir, { objectId: 'local:cat' });
    expect(ir.objects).toEqual([]);
    expect(result.ir.objects[0].pictures).toBeUndefined();
    expect(result.ir.objects[0].sounds).toBeUndefined();
    expect(result.validation.valid).toBe(true);
  });
});
