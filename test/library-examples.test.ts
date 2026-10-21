import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as tar from 'tar';
import { compileProject } from '../compiler/compile.ts';
import { auditCompiledProject } from '../compiler/audit-export.ts';
import { packPrepared, prepareExport } from '../compiler/pack.ts';
import { validateProject } from '../compiler/validate.ts';
import { verifyProject } from '../compiler/verify.ts';
import type { EntryIR } from '../src/types/ir.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLES = ['library-movement', 'library-dialogue', 'library-space'];

function loadExample(name: string): EntryIR {
  return JSON.parse(readFileSync(join(ROOT, 'examples', `${name}.ir.json`), 'utf8')) as EntryIR;
}

describe('reproducible local object library examples', () => {
  let workDir: string;
  let previousAssetsDir: string | undefined;
  let previousLibrary: string | undefined;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'entry-library-example-'));
    previousAssetsDir = process.env.ENTRY_VIBE_ASSETS_DIR;
    previousLibrary = process.env.ENTRY_VIBE_OBJECT_LIBRARY;
    process.env.ENTRY_VIBE_ASSETS_DIR = join(workDir, 'assets');
    delete process.env.ENTRY_VIBE_OBJECT_LIBRARY;
  });

  afterEach(() => {
    if (previousAssetsDir === undefined) delete process.env.ENTRY_VIBE_ASSETS_DIR;
    else process.env.ENTRY_VIBE_ASSETS_DIR = previousAssetsDir;
    if (previousLibrary === undefined) delete process.env.ENTRY_VIBE_OBJECT_LIBRARY;
    else process.env.ENTRY_VIBE_OBJECT_LIBRARY = previousLibrary;
    rmSync(workDir, { recursive: true, force: true });
  });

  it.each(EXAMPLES)('%s produces a self-contained archive and passes verification', async (name) => {
    const ir = loadExample(name);
    const validation = validateProject(ir);
    expect(validation.valid, validation.errors.join('\n')).toBe(true);

    const prepared = prepareExport(compileProject(ir));
    const entPath = join(workDir, `${name}.ent`);
    await packPrepared(prepared, { outputPath: entPath });

    const members: string[] = [];
    await tar.t({ file: entPath, onReadEntry: (entry) => { members.push(entry.path); } });
    expect(members).toContain('temp/project.json');
    const audit = auditCompiledProject(prepared.project, { tarPaths: members });
    expect(audit.ok, audit.errors.join('\n')).toBe(true);

    for (const object of prepared.project.objects) {
      const sprite = object.sprite as {
        pictures: Array<{ fileurl: string; thumbUrl: string }>;
        sounds: Array<{ fileurl: string }>;
      };
      for (const picture of sprite.pictures) {
        expect(members).toContain(picture.fileurl);
        expect(members).toContain(picture.thumbUrl);
      }
      for (const sound of sprite.sounds) expect(members).toContain(sound.fileurl);
    }

    const verification = await verifyProject(ir);
    expect(verification.ok, verification.errors.join('\n')).toBe(true);
    expect(verification.roundtrip?.ok).toBe(true);
  });

  it('movement preserves both cat costumes and the explicit animation block', () => {
    const project = compileProject(loadExample('library-movement'));
    const sprite = project.objects[0].sprite as { pictures: Array<{ id: string; name: string }> };
    expect(sprite.pictures).toHaveLength(2);
    expect(new Set(sprite.pictures.map((picture) => picture.id)).size).toBe(2);
    expect(new Set(sprite.pictures.map((picture) => picture.name)).size).toBe(2);
    expect(JSON.stringify(project.objects[0].script)).toContain('change_to_next_shape');
  });

  it('space uses one locked background and two scene-bound characters', () => {
    const project = compileProject(loadExample('library-space'));
    expect(project.objects).toHaveLength(3);
    expect(project.objects.find((object) => object.name === '우주 배경')?.lock).toBe(true);
    expect(new Set(project.objects.map((object) => object.scene))).toEqual(
      new Set([project.scenes[0].id]),
    );
  });
});
