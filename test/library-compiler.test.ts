import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as tar from 'tar';
import { compileProject, projectForExport } from '../compiler/compile.ts';
import { decompileProject } from '../compiler/decompile.ts';
import {
  createLibraryResolutionContext, MAX_PROJECT_LIBRARY_BYTES, parseLibraryAttributions,
  resolveIRLibraryObject,
} from '../compiler/library-media.ts';
import { packPrepared, prepareExport, writePendingAssets } from '../compiler/pack.ts';
import { unpackEnt } from '../compiler/unpack.ts';
import { validateProject } from '../compiler/validate.ts';
import { verifyProject } from '../compiler/verify.ts';
import { getObjectLibrary } from '../src/library/index.ts';
import type { EntryIR, EntryIRObject } from '../src/types/ir.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MEDIA = join(ROOT, 'assets', 'library', 'media');

function object(id = 'cat', name = id): EntryIRObject {
  return {
    name, sprite: 'library', library: { source: 'local', objectId: `local:${id}` },
    scripts: [[{ type: 'when_run_button_click' }, { type: 'move_direction', params: { VALUE: 10 } }]],
  };
}
type Sprite = {
  pictures: Array<{ id: string; name: string; fileurl: string; thumbUrl: string; filename: string }>;
  sounds: Array<{ id: string; name: string; fileurl: string; filename: string; duration: number }>;
};

describe('library objects through the real compiler and packer', () => {
  let work: string;
  let assets: string;
  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), 'entry-library-compiler-'));
    assets = join(work, 'assets');
    mkdirSync(assets);
    vi.stubEnv('ENTRY_VIBE_ASSETS_DIR', assets);
    vi.stubEnv('ENTRY_VIBE_OBJECT_LIBRARY', undefined);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(work, { recursive: true, force: true });
  });

  function userLibrary(kind: 'sprite' | 'background' = 'sprite') {
    copyFileSync(join(MEDIA, 'cat-walk1.png'), join(assets, 'first.png'));
    copyFileSync(join(MEDIA, 'cat-walk2.png'), join(assets, 'second.png'));
    copyFileSync(join(MEDIA, 'beep.mp3'), join(assets, 'tone.mp3'));
    const manifest = {
      version: 1,
      objects: [{
        id: 'hero', name: '사용자 모양', category: 'test', kind,
        costumes: [
          { id: 'first', name: '첫 번째', path: 'first.png', format: 'png' },
          { id: 'second', name: '두 번째', path: 'second.png', format: 'png' },
        ],
        sounds: [{ id: 'tone', name: '사용자 알림음', path: 'tone.mp3', format: 'mp3', duration: 0.444082 }],
        license: { spdx: 'CC0-1.0', attribution: 'Test fixture author', text: 'User-supplied test notice' },
      }],
    };
    writeFileSync(join(assets, 'objects.json'), JSON.stringify(manifest));
    vi.stubEnv('ENTRY_VIBE_OBJECT_LIBRARY', 'objects.json');
    return manifest;
  }

  it('preserves ordered costumes, sounds, positions, scene bindings and globally unique IDs', () => {
    const ir: EntryIR = {
      scenes: [{ name: '첫 장면' }, { name: '둘째 장면' }],
      objects: [{ ...object('cat'), x: -40, y: 20 }, { ...object('dog'), scene: '둘째 장면' }],
    };
    const project = compileProject(ir);
    const cat = project.objects[0];
    const sprite = cat.sprite as Sprite;
    expect(sprite.pictures.map((picture) => picture.name)).toEqual(['고양이_걷기1', '고양이_걷기2']);
    expect(sprite.sounds.map((sound) => sound.name)).toEqual(['알림음']);
    expect(sprite.sounds[0].duration).toBeGreaterThan(0);
    expect(cat.selectedPictureId).toBe(sprite.pictures[0].id);
    expect(cat.entity).toMatchObject({ x: -40, y: 20, width: 160, height: 160 });
    expect(project.objects[1].scene).toBe(project.scenes[1].id);
    const ids = [
      ...project.scenes.map((scene) => scene.id), ...project.variables.map((variable) => variable.id),
      ...project.objects.flatMap((entry) => {
        const media = entry.sprite as Sprite;
        return [entry.id, ...media.pictures.map((picture) => picture.id), ...media.sounds.map((sound) => sound.id)];
      }),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps explicit costume and sound names usable in native Entry script values', () => {
    const cat = object();
    cat.scripts[0].push(
      { type: 'change_to_some_shape', params: { VALUE: '고양이_걷기2' } },
      { type: 'sound_something_with_block', params: { VALUE: '알림음' } },
    );
    const project = compileProject({ objects: [cat] });
    const script = project.objects[0].script as Array<Array<{ params?: unknown[] }>>;
    // EntryJS EntryObject.getPicture/getSound resolve literal values by ID, name,
    // then index (src/class/object.js); names survive regenerated media IDs.
    expect(script[0][2].params?.[0]).toEqual({ type: 'text', params: ['고양이_걷기2'] });
    expect(script[0][3].params?.[0]).toEqual({ type: 'text', params: ['알림음'] });
    const sprite = project.objects[0].sprite as Sprite;
    expect(sprite.pictures.some((picture) => picture.name === '고양이_걷기2')).toBe(true);
    expect(sprite.sounds.some((sound) => sound.name === '알림음')).toBe(true);
  });

  it('deduplicates actual media, uses deterministic file IDs, and bundles unique MIT notices', async () => {
    const project = compileProject({ objects: [object('cat', '고양이 A'), object('cat', '고양이 B')] });
    const prepared = prepareExport(project);
    expect(prepared.assets).toHaveLength(3);
    expect(prepareExport(projectForExport(project))).toEqual(prepared);
    expect(prepared.libraryAttributions).toHaveLength(1);
    const a = prepared.project.objects[0].sprite as Sprite;
    const b = prepared.project.objects[1].sprite as Sprite;
    expect(a.pictures[0].filename).toBe(b.pictures[0].filename);
    expect(a.pictures[0].id).not.toBe(b.pictures[0].id);
    const ent = join(work, 'cats.ent');
    await packPrepared(prepared, { outputPath: ent });
    const extracted = join(work, 'extracted');
    mkdirSync(extracted);
    await tar.x({ file: ent, cwd: extracted });
    const raw = readFileSync(join(extracted, 'temp', 'project.json'), 'utf8');
    expect(raw).not.toMatch(/library-asset:|host-asset:/);
    for (const media of [...a.pictures, ...a.sounds]) {
      expect(media.fileurl).toMatch(/^temp\/[0-9a-f]{2}\/[0-9a-f]{2}\/(image|sound)\/[0-9a-f]{32}\.(png|mp3)$/);
      const bytes = readFileSync(join(extracted, media.fileurl));
      expect(bytes.length).toBeGreaterThan(100);
    }
    expect(readFileSync(join(extracted, a.pictures[0].fileurl))).toEqual(readFileSync(join(MEDIA, 'cat-walk1.png')));
    const notice = JSON.parse(readFileSync(join(extracted, 'temp', 'library-attribution.json'), 'utf8'));
    expect(notice.version).toBe(1);
    expect(notice.objects.map((entry: { id: string }) => entry.id)).toEqual(['local:cat']);
    expect(notice.objects[0].license.text).toContain('Permission is hereby granted');
  });

  it.each([
    ['missing reference', { library: undefined }],
    ['unknown ID', { library: { source: 'local', objectId: 'local:missing' } }],
    ['unavailable native Entry', { library: { source: 'entry', objectId: 'entry:unverified' } }],
    ['wrong source', { library: { source: 'user', objectId: 'local:cat' } }],
    ['ambiguous custom pictures', { pictures: [] }],
    ['ambiguous custom sounds', { sounds: [] }],
    ['reference on another sprite', { sprite: 'entrybot' }],
    ['reference on text', { kind: 'text', text: 'hello' }],
  ])('fails closed for %s, including strict:false', (_name, patch) => {
    const ir = { objects: [{ ...object(), ...patch }] } as EntryIR;
    expect(validateProject(ir).valid).toBe(false);
    expect(() => compileProject(ir, { strict: false })).toThrow();
  });

  it('imports user assets and holds their bytes safely after source files disappear', async () => {
    userLibrary();
    const hero = { ...object(), library: { source: 'user', objectId: 'user:hero' } };
    const expected = readFileSync(join(assets, 'first.png'));
    const project = compileProject({ objects: [hero] });
    rmSync(join(assets, 'first.png'));
    rmSync(join(assets, 'second.png'));
    rmSync(join(assets, 'tone.mp3'));
    rmSync(join(assets, 'objects.json'));
    const prepared = prepareExport(project);
    const ent = join(work, 'snapshot.ent');
    await packPrepared(prepared, { outputPath: ent });
    const { project: unpacked, media } = await unpackEnt(ent);
    const sprite = unpacked.objects[0].sprite as Sprite;
    const first = media.find((entry) => entry.fileId === sprite.pictures[0].filename);
    expect(readFileSync(first!.absolutePath)).toEqual(expected);
    expect(sprite.pictures.map((picture) => picture.name)).toEqual(['첫 번째', '두 번째']);
    expect(sprite.sounds[0].name).toBe('사용자 알림음');
  });

  it('preserves multi-costume and sounding backgrounds through real pack/decompile/recompile', async () => {
    userLibrary('background');
    const background: EntryIRObject = {
      name: '다중 배경', sprite: 'library', library: { source: 'user', objectId: 'user:hero' },
      scripts: [[{ type: 'when_run_button_click' }, { type: 'change_to_next_shape' }]],
    };
    const ir = { objects: [background, object('rocket')] };
    const project = compileProject(ir);
    expect(project.objects.at(-1)).toMatchObject({ name: '다중 배경', lock: true, rotateMethod: 'none' });
    const ent = join(work, 'background.ent');
    await packPrepared(prepareExport(project), { outputPath: ent });
    const unpacked = await unpackEnt(ent);
    const decoded = decompileProject(unpacked.project, { media: unpacked.media }).ir;
    const decodedBackground = decoded.objects.find((entry) => entry.name === '다중 배경');
    expect(decodedBackground).toMatchObject({ sprite: 'custom', background: true });
    expect(decodedBackground?.pictures).toHaveLength(2);
    expect(decodedBackground?.sounds).toHaveLength(1);
    const recompiled = compileProject(decoded);
    expect((recompiled.objects.at(-1)?.sprite as Sprite).pictures).toHaveLength(2);
    expect((recompiled.objects.at(-1)?.sprite as Sprite).sounds).toHaveLength(1);
    const verification = await verifyProject(ir);
    expect(verification.ok, verification.errors.join('\n')).toBe(true);
  });

  it('keeps a background-only project valid and uses the actual Entry stage dimensions', async () => {
    const ir = { objects: [{ ...object('space'), scripts: [] }] };
    expect(compileProject(ir).objects[0].entity).toMatchObject({ scaleX: 0.5, scaleY: 0.5 });
    const verification = await verifyProject(ir);
    expect(verification.ok, verification.errors.join('\n')).toBe(true);
  });

  it('preserves the logical stage scale of a static library background with foreground objects', async () => {
    const project = compileProject({ objects: [{ ...object('space'), scripts: [] }, object('rocket')] });
    const ent = join(work, 'space.ent');
    await packPrepared(prepareExport(project), { outputPath: ent });
    const unpacked = await unpackEnt(ent);
    const decoded = decompileProject(unpacked.project, { media: unpacked.media }).ir;
    expect(decoded.objects.find((entry) => entry.name === 'space')?.background).toBe(true);
    const recompiled = compileProject(decoded);
    expect(recompiled.objects.at(-1)?.entity).toMatchObject({ scaleX: 0.5, scaleY: 0.5 });
  });

  it('does not introduce Entrybot sounds on soundless library roundtrip, while Entrybot stays compatible', async () => {
    const ent = join(work, 'mixed.ent');
    const project = compileProject({ objects: [object('car'), { name: '기본', scripts: [[{ type: 'when_run_button_click' }]] }] });
    expect((project.objects[0].sprite as Sprite).sounds).toEqual([]);
    expect((project.objects[1].sprite as Sprite).pictures).toHaveLength(2);
    expect((project.objects[1].sprite as Sprite).sounds).toHaveLength(1);
    await packPrepared(prepareExport(project), { outputPath: ent });
    const unpacked = await unpackEnt(ent);
    const decoded = decompileProject(unpacked.project, { media: unpacked.media }).ir;
    expect(decoded.objects[0].sounds).toEqual([]);
    expect((compileProject(decoded).objects[0].sprite as Sprite).sounds).toEqual([]);
    expect(decoded.objects[1].sprite).toBe('entrybot');
  });

  it('canonicalizes shared buffers across catalog IDs and rejects an exhausted project budget', () => {
    const context = createLibraryResolutionContext();
    const cat = resolveIRLibraryObject(object('cat'), context)!;
    const dog = resolveIRLibraryObject(object('dog'), context)!;
    expect(cat.sounds[0].bytes).toBe(dog.sounds[0].bytes);
    expect(resolveIRLibraryObject(object('cat'), context)).toBe(cat);
    expect(context.objects.size).toBe(2);
    const full = createLibraryResolutionContext();
    full.totalBytes = MAX_PROJECT_LIBRARY_BYTES;
    expect(() => resolveIRLibraryObject(object('car'), full)).toThrow(/project budget/);
    expect(full.objects.size).toBe(0);
  });

  it('rejects missing binary state, unsafe archive paths and duplicate generated identifiers', () => {
    expect(() => prepareExport(structuredClone(compileProject({ objects: [object()] })))).toThrow(/media bytes are missing/);
    const legacy = compileProject({ objects: [{ name: '기본', scripts: [[{ type: 'when_run_button_click' }]] }] });
    expect(() => prepareExport(legacy, { createFileId: () => 'a'.repeat(32) })).toThrow(/duplicate media file ID/);
    expect(() => prepareExport(legacy, { createFileId: () => '../escape' })).toThrow(/hexadecimal/);
    expect(() => writePendingAssets([
      { kind: 'sound', fileId: '../escape', source: { type: 'library', bytes: Buffer.from('data') } },
    ], work, MEDIA)).toThrow(/unsafe media file ID/);
  });

  it('rejects malformed retained licensing notices rather than emitting arbitrary metadata', () => {
    const entry = getObjectLibrary().getObject('local:cat');
    const notice = { id: entry.id, source: entry.source, name: entry.name, license: entry.license };
    expect(parseLibraryAttributions([notice])[0].license.text).toContain('MIT License');
    expect(() => parseLibraryAttributions([{ ...notice, source: 'entry' }])).toThrow();
    expect(() => parseLibraryAttributions([notice, notice])).toThrow();
    expect(() => parseLibraryAttributions([{ ...notice, license: { ...entry.license, url: 'javascript:alert(1)' } }])).toThrow();
  });
});
