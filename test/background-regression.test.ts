/**
 * Background-layer detection regressions.
 *
 * EntryJS decides whether an object is a stage background from
 * `sprite.category.main === 'background'`
 * (vendor/entryjs/src/class/container.js:394). The decompiler must not infer a
 * background from `rotateMethod === 'none'`: any locked sprite may carry that
 * value, which silently turned ordinary objects into backgrounds.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { compileProject } from '../compiler/compile.ts';
import { decompileProject } from '../compiler/decompile.ts';
import { packPrepared, prepareExport } from '../compiler/pack.ts';
import type { EntryProject } from '../compiler/skeleton.ts';
import { unpackEnt } from '../compiler/unpack.ts';
import type { EntryIR, EntryIRObject } from '../src/types/ir.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = join(ROOT, 'test', 'fixtures');

const temps: string[] = [];

function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'entry-background-'));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  delete process.env.ENTRY_VIBE_ASSETS_DIR;
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function entrybotIR(name: string, scripts: EntryIRObject['scripts'] = defaultThread()): EntryIR {
  return { objects: [{ name, sprite: 'entrybot', scripts }] };
}

function defaultThread(): EntryIRObject['scripts'] {
  return [[{ type: 'when_run_button_click' }, { type: 'move_direction', params: { VALUE: 10 } }]];
}

function libraryObject(name: string, objectId: string, scene?: string): EntryIRObject {
  return {
    name,
    sprite: 'library',
    library: { source: 'local', objectId },
    scripts: [],
    ...(scene ? { scene } : {}),
  };
}

function compiledObject(project: EntryProject, name: string): Record<string, unknown> {
  const object = project.objects.find((entry) => entry.name === name);
  if (!object) throw new Error(`compiled object not found: ${name}`);
  return object;
}

function categoryMain(object: Record<string, unknown>): unknown {
  const sprite = object.sprite as { category?: { main?: string } } | undefined;
  return sprite?.category?.main;
}

describe('background detection (EntryJS category contract)', () => {
  it('T1: a locked ordinary sprite with rotateMethod none is not a background', () => {
    const project = compileProject(entrybotIR('잠긴 스프라이트'));
    const object = compiledObject(project, '잠긴 스프라이트');
    object.lock = true;
    object.rotateMethod = 'none';

    const decoded = decompileProject(project).ir;
    const sprite = decoded.objects.find((entry) => entry.name === '잠긴 스프라이트');

    expect(sprite?.background).toBeUndefined();
    expect(sprite?.sprite).toBe('entrybot');
  });

  it('T2: rotateMethod none alone is not a background signal', () => {
    const project = compileProject(entrybotIR('회전 자유 스프라이트'));
    const object = compiledObject(project, '회전 자유 스프라이트');
    object.rotateMethod = 'none';

    const decoded = decompileProject(project).ir;
    const sprite = decoded.objects.find((entry) => entry.name === '회전 자유 스프라이트');

    expect(sprite?.background).toBeUndefined();
  });

  it('T3: a locked sprite with scripts stays a normal object', () => {
    const project = compileProject(entrybotIR('잠긴 스프라이트'));
    const object = compiledObject(project, '잠긴 스프라이트');
    object.lock = true;
    object.rotateMethod = 'none';

    const decoded = decompileProject(project).ir;
    const sprite = decoded.objects.find((entry) => entry.name === '잠긴 스프라이트');

    expect(sprite?.background).toBeUndefined();
    expect(sprite?.scripts).toHaveLength(1);
    expect(sprite?.scripts[0]).toHaveLength(2);
  });

  it('T4: scene backgrounds compile with category and round-trip through scene.background', () => {
    process.env.ENTRY_VIBE_ASSETS_DIR = join(FIXTURES, 'assets');
    const ir: EntryIR = {
      scenes: [{ name: '시작', background: { name: '배경', path: 'assets/dot.png' } }],
      objects: [{ name: '플레이어', sprite: 'entrybot', scripts: defaultThread() }],
    };

    const project = compileProject(ir);
    const background = compiledObject(project, '배경');
    expect(categoryMain(background)).toBe('background');
    expect(background.lock).toBe(true);
    expect(background.rotateMethod).toBe('none');

    const decoded = decompileProject(project).ir;
    expect(decoded.scenes?.[0]).toMatchObject({
      name: '시작',
      background: { name: '배경', path: 'assets/dot.png' },
    });
    expect(decoded.objects.some((entry) => entry.name === '배경')).toBe(false);
  });

  it('T5: a library background carries category, lock and the 480-scale entity', () => {
    const project = compileProject({ objects: [libraryObject('우주', 'local:space')] });
    const background = compiledObject(project, '우주');

    expect(categoryMain(background)).toBe('background');
    expect(background.lock).toBe(true);
    expect(background.rotateMethod).toBe('none');
    expect(background.entity).toMatchObject({ scaleX: 0.5, scaleY: 0.5 });

    const decoded = decompileProject(project).ir;
    expect(decoded.objects.find((entry) => entry.name === '우주')?.background).toBe(true);
  });

  it('T6: a background-only project remains an object instead of scene.background', () => {
    const decoded = decompileProject(
      compileProject({ objects: [libraryObject('우주', 'local:space')] }),
    ).ir;

    expect(decoded.objects).toHaveLength(1);
    expect(decoded.objects[0]).toMatchObject({ name: '우주', background: true });
    expect((decoded.scenes ?? []).every((scene) => scene.background === undefined)).toBe(true);
  });

  it('T7: backgrounds move after foreground objects while keeping their own order', () => {
    const rocket: EntryIRObject = {
      ...libraryObject('로켓', 'local:rocket'),
      scripts: defaultThread(),
    };
    const project = compileProject({
      objects: [
        libraryObject('우주1', 'local:space'),
        rocket,
        libraryObject('우주2', 'local:space'),
      ],
    });

    expect(project.objects.map((entry) => entry.name)).toEqual(['로켓', '우주1', '우주2']);
    const backgrounds = project.objects
      .filter((entry) => categoryMain(entry) === 'background')
      .map((entry) => entry.name);
    expect(backgrounds).toEqual(['우주1', '우주2']);

    const decoded = decompileProject(project).ir;
    expect(decoded.objects.map((entry) => entry.name)).toEqual(['로켓', '우주1', '우주2']);
  });

  it('T8: scene bindings survive for foreground and background objects', () => {
    const rocket: EntryIRObject = {
      ...libraryObject('로켓', 'local:rocket', 'A'),
      scripts: defaultThread(),
    };
    const ir: EntryIR = {
      scenes: [{ name: 'A' }, { name: 'B' }],
      objects: [
        libraryObject('우주1', 'local:space', 'A'),
        rocket,
        libraryObject('우주2', 'local:space', 'B'),
      ],
    };

    const decoded = decompileProject(compileProject(ir)).ir;
    expect(decoded.objects.find((entry) => entry.name === '로켓')).toMatchObject({ scene: 'A' });
    expect(decoded.objects.find((entry) => entry.name === '우주1')).toMatchObject({
      scene: 'A',
      background: true,
    });
    expect(decoded.objects.find((entry) => entry.name === '우주2')).toMatchObject({
      scene: 'B',
      background: true,
    });
  });

  it('T9: the legacy 배경 name fallback still detects imported backgrounds', () => {
    const project = compileProject(entrybotIR('배경 (숲)'));
    const object = compiledObject(project, '배경 (숲)');
    object.lock = true;
    object.rotateMethod = 'none';

    const decoded = decompileProject(project).ir;
    expect(decoded.objects.find((entry) => entry.name === '배경 (숲)')?.background).toBe(true);
  });

  it('T10: a library background survives a real pack/unpack/recompile cycle', async () => {
    const work = temp();
    process.env.ENTRY_VIBE_ASSETS_DIR = join(work, 'assets');
    const ir: EntryIR = {
      objects: [
        libraryObject('우주', 'local:space'),
        { ...libraryObject('로켓', 'local:rocket'), scripts: defaultThread() },
      ],
    };

    const ent = join(work, 'roundtrip.ent');
    await packPrepared(prepareExport(compileProject(ir)), { outputPath: ent });
    const unpacked = await unpackEnt(ent, { cwd: work });
    const decoded = decompileProject(unpacked.project, { media: unpacked.media }).ir;

    const background = decoded.objects.find((entry) => entry.name === '우주');
    expect(background?.background).toBe(true);
    expect(background?.pictures).toHaveLength(1);

    const recompiled = compileProject(decoded);
    const last = recompiled.objects.at(-1);
    expect(last?.name).toBe('우주');
    expect(last?.entity).toMatchObject({ scaleX: 0.5, scaleY: 0.5 });
    expect(categoryMain(last!)).toBe('background');
  });
});
