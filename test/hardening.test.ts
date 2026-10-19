/**
 * Phase 1 hardening regression tests.
 *
 * - unpackEnt: archive path/type/size limits, assets/ isolation
 * - packPrepared / writePreparedJson / writePreparedOutputs: overwrite refusal,
 *   atomic writes, no partial outputs on failure
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as tar from 'tar';
import { compileProject } from '../compiler/compile.ts';
import {
  packEnt,
  packPrepared,
  prepareExport,
  writePreparedJson,
  writePreparedOutputs,
} from '../compiler/pack.ts';
import { unpackEnt } from '../compiler/unpack.ts';
import type { EntryIR } from '../src/types/ir.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = join(ROOT, 'test', 'fixtures');
const CATALOG = join(ROOT, 'catalog', 'blocks.json');

const tempRoots: string[] = [];

function makeTemp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop() as string, { recursive: true, force: true });
  }
});

function loadIR(name: string): EntryIR {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as EntryIR;
}

function compileFixture() {
  return compileProject(loadIR('entrybot-basic.ir.json'));
}

async function writeValidEnt(dir: string, name = 'valid.ent'): Promise<string> {
  return packEnt(compileFixture(), { outputPath: join(dir, name) });
}

/** Craft a tar.gz whose entry paths are rewritten by `rewrite` (malicious archives). */
async function craftEnt(
  dir: string,
  fileNames: string[],
  rewrite?: (path: string) => string,
): Promise<string> {
  for (const name of fileNames) {
    writeFileSync(join(dir, name), 'payload');
  }
  const out = join(dir, 'crafted.ent');
  await tar.c(
    {
      gzip: true,
      file: out,
      cwd: dir,
      onWriteEntry: rewrite
        ? (entry) => {
            entry.path = rewrite(entry.path);
          }
        : undefined,
    },
    fileNames,
  );
  return out;
}

describe.skipIf(!existsSync(CATALOG))('phase1 unpack hardening', () => {
  it('rejects archive entries that escape the extraction root', async () => {
    const dir = makeTemp('entry-vibe-craft-');
    const ent = await craftEnt(dir, ['evil.txt'], () => '../evil.txt');
    const cwd = makeTemp('entry-vibe-host-');
    await expect(unpackEnt(ent, { cwd })).rejects.toThrow(/escapes extraction root/);
    expect(existsSync(join(dirname(cwd), 'evil.txt'))).toBe(false);
  });

  it('rejects absolute archive entry paths', async () => {
    const dir = makeTemp('entry-vibe-craft-');
    const ent = await craftEnt(dir, ['evil.txt'], () => '/tmp/entry-vibe-evil.txt');
    const cwd = makeTemp('entry-vibe-host-');
    await expect(unpackEnt(ent, { cwd })).rejects.toThrow(/must be relative/);
    expect(existsSync('/tmp/entry-vibe-evil.txt')).toBe(false);
  });

  it('rejects symlink archive entries', async () => {
    const dir = makeTemp('entry-vibe-craft-');
    writeFileSync(join(dir, 'target.txt'), 'payload');
    symlinkSync(join(dir, 'target.txt'), join(dir, 'link.txt'));
    const out = join(dir, 'symlink.ent');
    await tar.c({ gzip: true, file: out, cwd: dir }, ['target.txt', 'link.txt']);
    const cwd = makeTemp('entry-vibe-host-');
    await expect(unpackEnt(out, { cwd })).rejects.toThrow(/unsupported archive entry type/);
  });

  it('enforces maxEntries', async () => {
    const dir = makeTemp('entry-vibe-');
    const ent = await writeValidEnt(dir);
    const cwd = makeTemp('entry-vibe-host-');
    await expect(unpackEnt(ent, { cwd, maxEntries: 2 })).rejects.toThrow(/more than 2 entries/);
  });

  it('enforces maxFileBytes', async () => {
    const dir = makeTemp('entry-vibe-');
    const ent = await writeValidEnt(dir);
    const cwd = makeTemp('entry-vibe-host-');
    await expect(unpackEnt(ent, { cwd, maxFileBytes: 1 })).rejects.toThrow(/exceeds maxFileBytes/);
  });

  it('enforces maxTotalBytes', async () => {
    const dir = makeTemp('entry-vibe-');
    const ent = await writeValidEnt(dir);
    const cwd = makeTemp('entry-vibe-host-');
    await expect(unpackEnt(ent, { cwd, maxTotalBytes: 16 })).rejects.toThrow(
      /exceeds maxTotalBytes/,
    );
  });

  it('rejects non-positive limits', async () => {
    const dir = makeTemp('entry-vibe-');
    const ent = await writeValidEnt(dir);
    const cwd = makeTemp('entry-vibe-host-');
    await expect(unpackEnt(ent, { cwd, maxEntries: 0 })).rejects.toThrow(/positive finite/);
  });

  it('extractMedia:false does not create or copy into host assets/', async () => {
    const dir = makeTemp('entry-vibe-');
    const ent = await writeValidEnt(dir);
    const cwd = makeTemp('entry-vibe-host-');
    const result = await unpackEnt(ent, { cwd, extractMedia: false });
    expect(existsSync(join(cwd, 'assets'))).toBe(false);
    expect(result.media.length).toBeGreaterThan(0);
    for (const media of result.media) {
      expect(existsSync(media.absolutePath)).toBe(false);
    }
  });

  it('copies bundled media into assets/imported by default', async () => {
    const dir = makeTemp('entry-vibe-');
    const ent = await writeValidEnt(dir);
    const cwd = makeTemp('entry-vibe-host-');
    const result = await unpackEnt(ent, { cwd });
    expect(result.media.length).toBeGreaterThan(0);
    expect(existsSync(join(cwd, 'assets', 'imported'))).toBe(true);
    for (const media of result.media) {
      expect(existsSync(media.absolutePath)).toBe(true);
    }
  });

  it('reports safe tarPaths for every extracted entry', async () => {
    const dir = makeTemp('entry-vibe-');
    const ent = await writeValidEnt(dir);
    const cwd = makeTemp('entry-vibe-host-');
    const result = await unpackEnt(ent, { cwd });
    expect(result.tarPaths).toContain('temp/project.json');
    expect(result.tarPaths.every((p) => !p.startsWith('/') && !p.includes('..'))).toBe(true);
  });
});

describe.skipIf(!existsSync(CATALOG))('phase1 atomic outputs', () => {
  it('writePreparedOutputs refuses to overwrite when overwrite:false', async () => {
    const dir = makeTemp('entry-vibe-out-');
    const entPath = join(dir, 'game.ent');
    const jsonPath = join(dir, 'game.json');
    await writePreparedOutputs(prepareExport(compileFixture()), {
      entPath,
      jsonPath,
      overwrite: true,
    });
    const jsonBefore = readFileSync(jsonPath, 'utf8');
    const entBefore = readFileSync(entPath);
    await expect(
      writePreparedOutputs(prepareExport(compileFixture()), {
        entPath,
        jsonPath,
        overwrite: false,
      }),
    ).rejects.toThrow(/refusing to overwrite/);
    expect(readFileSync(jsonPath, 'utf8')).toBe(jsonBefore);
    expect(readFileSync(entPath).equals(entBefore)).toBe(true);
  });

  it('writePreparedOutputs leaves no partial outputs when packing fails', async () => {
    const dir = makeTemp('entry-vibe-out-');
    const entPath = join(dir, 'game.ent');
    const jsonPath = join(dir, 'game.json');
    const emptyMedia = join(dir, 'empty-media');
    mkdirSync(emptyMedia);
    await expect(
      writePreparedOutputs(prepareExport(compileFixture()), {
        entPath,
        jsonPath,
        overwrite: true,
        mediaDir: emptyMedia,
      }),
    ).rejects.toThrow(/Missing media file/);
    expect(existsSync(entPath)).toBe(false);
    expect(existsSync(jsonPath)).toBe(false);
    expect(readdirSync(dir)).toEqual(['empty-media']);
  });

  it('writePreparedOutputs overwrite:true replaces existing files atomically', async () => {
    const dir = makeTemp('entry-vibe-out-');
    const entPath = join(dir, 'game.ent');
    const jsonPath = join(dir, 'game.json');
    writeFileSync(entPath, 'stale');
    writeFileSync(jsonPath, 'stale');
    await writePreparedOutputs(prepareExport(compileFixture()), {
      entPath,
      jsonPath,
      overwrite: true,
    });
    const entBytes = readFileSync(entPath);
    expect(entBytes[0]).toBe(0x1f);
    expect(entBytes[1]).toBe(0x8b);
    expect(() => JSON.parse(readFileSync(jsonPath, 'utf8'))).not.toThrow();
    expect(readdirSync(dir).sort()).toEqual(['game.ent', 'game.json']);
  });

  it('packPrepared refuses to overwrite when overwrite:false', async () => {
    const dir = makeTemp('entry-vibe-out-');
    const entPath = join(dir, 'game.ent');
    const prepared = prepareExport(compileFixture());
    await packPrepared(prepared, { outputPath: entPath });
    await expect(packPrepared(prepared, { outputPath: entPath, overwrite: false })).rejects.toThrow(
      /refusing to overwrite/,
    );
  });

  it('writePreparedJson refuses to overwrite when overwrite:false', async () => {
    const dir = makeTemp('entry-vibe-out-');
    const jsonPath = join(dir, 'game.json');
    const prepared = prepareExport(compileFixture());
    writePreparedJson(prepared, jsonPath);
    const before = readFileSync(jsonPath, 'utf8');
    expect(() => writePreparedJson(prepared, jsonPath, { overwrite: false })).toThrow(
      /refusing to overwrite/,
    );
    expect(readFileSync(jsonPath, 'utf8')).toBe(before);
  });
});
