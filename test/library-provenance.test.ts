import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as tar from 'tar';
import { compileProject } from '../compiler/compile.ts';
import { decompileProject } from '../compiler/decompile.ts';
import { packPrepared, prepareExport } from '../compiler/pack.ts';
import { unpackEnt } from '../compiler/unpack.ts';
import type { EntryIR } from '../src/types/ir.ts';

const ir: EntryIR = {
  objects: [{
    name: '고양이', sprite: 'library',
    library: { source: 'local', objectId: 'local:cat' },
    scripts: [[{ type: 'when_run_button_click' }]],
  }],
};

describe('library license notices across archive imports', () => {
  let dir: string;
  let previousAssets: string | undefined;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'entry-library-notices-'));
    previousAssets = process.env.ENTRY_VIBE_ASSETS_DIR;
    process.env.ENTRY_VIBE_ASSETS_DIR = join(dir, 'assets');
  });
  afterEach(() => {
    if (previousAssets === undefined) delete process.env.ENTRY_VIBE_ASSETS_DIR;
    else process.env.ENTRY_VIBE_ASSETS_DIR = previousAssets;
    rmSync(dir, { recursive: true, force: true });
  });

  it('keeps MIT notices when library media becomes custom media and is exported again', async () => {
    const original = prepareExport(compileProject(ir));
    const filename = join(dir, 'original.ent');
    await packPrepared(original, { outputPath: filename });
    const unpacked = await unpackEnt(filename);
    const decoded = decompileProject(unpacked.project, { media: unpacked.media });
    expect(decoded.ir.objects[0].sprite).toBe('custom');
    expect(decoded.ir.assetAttributions).toEqual(original.libraryAttributions);
    const second = prepareExport(compileProject(decoded.ir));
    expect(second.libraryAttributions).toEqual(original.libraryAttributions);
    expect(second.libraryAttributions?.[0].license.text).toContain('Permission is hereby granted');
    await packPrepared(second, { outputPath: join(dir, 'second.ent') });
    const members: string[] = [];
    await tar.t({ file: join(dir, 'second.ent'), onReadEntry: (entry) => { members.push(entry.path); } });
    expect(members).toContain('temp/library-attribution.json');
  });

  it.each([
    { version: 2, objects: [] },
    { version: 1, objects: [{ id: 'local:cat', source: 'entry', name: 'cat', license: { spdx: 'MIT', attribution: 'x' } }] },
    { version: 1, objects: [{ id: 'local:cat', source: 'local', name: 'cat', license: { spdx: 'MIT', attribution: 'x', url: 'file:///etc/passwd' } }] },
  ])('rejects malformed notice metadata before importing files: %j', async (document) => {
    const staging = join(dir, 'staging');
    mkdirSync(join(staging, 'temp'), { recursive: true });
    writeFileSync(join(staging, 'temp/project.json'), JSON.stringify(prepareExport(compileProject(ir)).project));
    writeFileSync(join(staging, 'temp/library-attribution.json'), JSON.stringify(document));
    const filename = join(dir, 'invalid.ent');
    await tar.c({ gzip: true, file: filename, cwd: staging }, ['temp']);
    await expect(unpackEnt(filename)).rejects.toThrow();
    expect(existsSync(join(dir, 'assets'))).toBe(false);
  });
});
