import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fsState = vi.hoisted(() => ({ hiddenPaths: [] as string[] }));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: (target: Parameters<typeof actual.existsSync>[0]) =>
      fsState.hiddenPaths.includes(String(target)) ? false : actual.existsSync(target),
  };
});

import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileProject } from '../compiler/compile.ts';
import {
  packPrepared,
  prepareExport,
  writePreparedJson,
  writePreparedOutputs,
} from '../compiler/pack.ts';
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

function loadIR(name: string): EntryIR {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as EntryIR;
}

function compileFixture() {
  return compileProject(loadIR('entrybot-basic.ir.json'));
}

beforeEach(() => {
  fsState.hiddenPaths.length = 0;
});

afterEach(() => {
  fsState.hiddenPaths.length = 0;
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop() as string, { recursive: true, force: true });
  }
});

describe.skipIf(!existsSync(CATALOG))('phase1 pack concurrency', () => {
  it('packPrepared refuses a target that appears after the guard', async () => {
    const dir = makeTemp('entry-vibe-race-');
    const entPath = join(dir, 'game.ent');
    const sentinel = 'raced-in-ent';
    writeFileSync(entPath, sentinel);
    fsState.hiddenPaths.push(entPath);

    await expect(
      packPrepared(prepareExport(compileFixture()), { outputPath: entPath, overwrite: false }),
    ).rejects.toThrow(/refusing to overwrite/);

    fsState.hiddenPaths.length = 0;
    expect(readFileSync(entPath, 'utf8')).toBe(sentinel);
    expect(readdirSync(dir)).toEqual(['game.ent']);
  });

  it('writePreparedJson refuses a target that appears after the guard', () => {
    const dir = makeTemp('entry-vibe-race-');
    const jsonPath = join(dir, 'game.json');
    const sentinel = '{"raced":true}';
    writeFileSync(jsonPath, sentinel);
    fsState.hiddenPaths.push(jsonPath);

    expect(() =>
      writePreparedJson(prepareExport(compileFixture()), jsonPath, { overwrite: false }),
    ).toThrow(/refusing to overwrite/);

    fsState.hiddenPaths.length = 0;
    expect(readFileSync(jsonPath, 'utf8')).toBe(sentinel);
    expect(readdirSync(dir)).toEqual(['game.json']);
  });

  it('writePreparedOutputs rolls back files it created when a later target was raced in', async () => {
    const dir = makeTemp('entry-vibe-race-');
    const entPath = join(dir, 'game.ent');
    const jsonPath = join(dir, 'game.json');
    const sentinel = 'raced-in-ent';
    writeFileSync(entPath, sentinel);
    fsState.hiddenPaths.push(entPath);

    await expect(
      writePreparedOutputs(prepareExport(compileFixture()), {
        entPath,
        jsonPath,
        overwrite: false,
      }),
    ).rejects.toThrow(/refusing to overwrite/);

    fsState.hiddenPaths.length = 0;
    expect(readFileSync(entPath, 'utf8')).toBe(sentinel);
    expect(readdirSync(dir)).toEqual(['game.ent']);
  });

  it('writePreparedOutputs leaves later targets untouched when the first target was raced in', async () => {
    const dir = makeTemp('entry-vibe-race-');
    const entPath = join(dir, 'game.ent');
    const jsonPath = join(dir, 'game.json');
    const sentinel = '{"raced":true}';
    writeFileSync(jsonPath, sentinel);
    fsState.hiddenPaths.push(jsonPath);

    await expect(
      writePreparedOutputs(prepareExport(compileFixture()), {
        entPath,
        jsonPath,
        overwrite: false,
      }),
    ).rejects.toThrow(/refusing to overwrite/);

    fsState.hiddenPaths.length = 0;
    expect(readFileSync(jsonPath, 'utf8')).toBe(sentinel);
    expect(existsSync(entPath)).toBe(false);
    expect(readdirSync(dir)).toEqual(['game.json']);
  });
});
