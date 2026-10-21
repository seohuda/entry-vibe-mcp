/**
 * EntryJS load-contract compatibility.
 *
 * EntryJS recognises backgrounds only through `sprite.category.main ===
 * 'background'` (vendor/entryjs/src/class/container.js:394) and draws the LAST
 * object of the array at the lowest child index, i.e. the backmost layer
 * (vendor/entryjs/src/class/stage.js:280). These tests read the packed
 * `project.json` back out of a real `.ent` archive, so a writer change cannot
 * silently break the contract that the compiler already satisfies in memory.
 */
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { compileProject } from '../compiler/compile.ts';
import { packPrepared, prepareExport } from '../compiler/pack.ts';
import { unpackEnt } from '../compiler/unpack.ts';
import type { EntryIR, EntryIRObject } from '../src/types/ir.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_ASSETS = join(ROOT, 'test', 'fixtures', 'assets');

interface RawSprite {
  category?: { main?: string };
  pictures?: Array<{ dimension?: { width?: number; height?: number } }>;
}

interface RawObject {
  name?: unknown;
  lock?: unknown;
  rotateMethod?: unknown;
  sprite?: RawSprite;
  entity?: Record<string, unknown>;
}

const temps: string[] = [];

function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'entry-entryjs-compat-'));
  temps.push(dir);
  return dir;
}

function libraryObject(name: string, objectId: string): EntryIRObject {
  return { name, sprite: 'library', library: { source: 'local', objectId }, scripts: [] };
}

function findObject(project: { objects: unknown[] }, name: string): RawObject {
  const found = (project.objects as RawObject[]).find((entry) => entry.name === name);
  if (!found) throw new Error(`packed object not found: ${name}`);
  return found;
}

afterEach(() => {
  delete process.env.ENTRY_VIBE_ASSETS_DIR;
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('EntryJS project.json contract', () => {
  it('packs a legacy scene.background as the backmost 960x540 layer', async () => {
    const work = temp();
    const assets = join(work, 'assets');
    mkdirSync(assets, { recursive: true });
    copyFileSync(join(FIXTURE_ASSETS, 'dot.png'), join(assets, 'dot.png'));
    process.env.ENTRY_VIBE_ASSETS_DIR = assets;
    const ent = join(work, 'scene-background.ent');
    const ir: EntryIR = {
      scenes: [{ name: '시작', background: { name: '배경', path: 'assets/dot.png' } }],
      objects: [{ name: '플레이어', sprite: 'entrybot', scripts: [[{ type: 'when_run_button_click' }]] }],
    };

    await packPrepared(prepareExport(compileProject(ir)), { outputPath: ent });
    const { project } = await unpackEnt(ent, { cwd: work });

    // stage.sortZorder() walks the array backwards, so the last entry is the
    // backmost layer. A scene background must sit behind every foreground.
    expect((project.objects as RawObject[]).map((entry) => entry.name).at(-1)).toBe('배경');

    const background = findObject(project, '배경');
    expect(background.sprite?.category).toEqual({ main: 'background' });
    expect(background.lock).toBe(true);
    expect(background.rotateMethod).toBe('none');
    expect(background.sprite?.pictures?.[0]?.dimension).toEqual({ width: 1, height: 1 });
    expect(background.entity).toMatchObject({ width: 1, height: 1, scaleX: 960, scaleY: 960 });
  });

  it('packs a library background behind foreground objects at the 480 stage scale', async () => {
    const work = temp();
    mkdirSync(join(work, 'assets'), { recursive: true });
    process.env.ENTRY_VIBE_ASSETS_DIR = join(work, 'assets');
    const ent = join(work, 'library-background.ent');
    const ir: EntryIR = {
      objects: [
        libraryObject('우주', 'local:space'),
        {
          name: '로켓',
          sprite: 'library',
          library: { source: 'local', objectId: 'local:rocket' },
          scripts: [[{ type: 'when_run_button_click' }]],
        },
      ],
    };

    await packPrepared(prepareExport(compileProject(ir)), { outputPath: ent });
    const { project } = await unpackEnt(ent);

    expect((project.objects as RawObject[]).map((entry) => entry.name)).toEqual(['로켓', '우주']);
    const background = findObject(project, '우주');
    expect(background.sprite?.category).toEqual({ main: 'background' });
    expect(background.lock).toBe(true);
    expect(background.rotateMethod).toBe('none');
    expect(background.entity).toMatchObject({ width: 960, height: 540, scaleX: 0.5, scaleY: 0.5 });
  });

  it('keeps each scene background behind that scene’s own foreground objects', async () => {
    const work = temp();
    mkdirSync(join(work, 'assets'), { recursive: true });
    process.env.ENTRY_VIBE_ASSETS_DIR = join(work, 'assets');
    const ent = join(work, 'multi-scene.ent');
    const ir: EntryIR = {
      scenes: [{ name: 'A' }, { name: 'B' }],
      objects: [
        { ...libraryObject('우주A', 'local:space'), scene: 'A' },
        {
          name: '로켓B',
          sprite: 'library',
          library: { source: 'local', objectId: 'local:rocket' },
          scripts: [[{ type: 'when_run_button_click' }]],
          scene: 'B',
        },
        { ...libraryObject('우주B', 'local:space'), scene: 'B' },
      ],
    };

    await packPrepared(prepareExport(compileProject(ir)), { outputPath: ent });
    const { project } = await unpackEnt(ent);

    const sceneIds = new Map(
      ((project.scenes ?? []) as Array<{ id: string; name: string }>).map((scene) => [scene.name, scene.id]),
    );
    const sceneA = (project.objects as Array<RawObject & { scene?: unknown }>)
      .filter((entry) => entry.scene === sceneIds.get('A'))
      .map((entry) => entry.name);
    const sceneB = (project.objects as Array<RawObject & { scene?: unknown }>)
      .filter((entry) => entry.scene === sceneIds.get('B'))
      .map((entry) => entry.name);
    expect(sceneA.at(-1)).toBe('우주A');
    expect(sceneB.at(-1)).toBe('우주B');
  });

  it('keeps a legacy scene backdrop behind a library background of the same scene', async () => {
    const work = temp();
    const assets = join(work, 'assets');
    mkdirSync(assets, { recursive: true });
    copyFileSync(join(FIXTURE_ASSETS, 'dot.png'), join(assets, 'dot.png'));
    process.env.ENTRY_VIBE_ASSETS_DIR = assets;
    const ent = join(work, 'mixed-background.ent');
    const ir: EntryIR = {
      scenes: [{ name: '시작', background: { name: '배경', path: 'assets/dot.png' } }],
      objects: [
        {
          name: '로켓',
          sprite: 'library',
          library: { source: 'local', objectId: 'local:rocket' },
          scripts: [[{ type: 'when_run_button_click' }]],
        },
        libraryObject('우주', 'local:space'),
      ],
    };

    await packPrepared(prepareExport(compileProject(ir)), { outputPath: ent });
    const { project } = await unpackEnt(ent, { cwd: work });

    const names = (project.objects as RawObject[]).map((entry) => entry.name);
    expect(names).toEqual(['로켓', '우주', '배경']);
    expect(findObject(project, '배경').sprite?.category).toEqual({ main: 'background' });
    expect(findObject(project, '우주').sprite?.category).toEqual({ main: 'background' });
  });
});
