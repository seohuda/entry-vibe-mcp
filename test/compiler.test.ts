import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as tar from 'tar';
import { compileProject, CompileError } from '../compiler/compile.ts';
import { validateProject } from '../compiler/validate.ts';
import { packEnt } from '../compiler/pack.ts';
import type { EntryIR } from '../src/types/ir.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = join(ROOT, 'test', 'fixtures');
const CATALOG = join(ROOT, 'catalog', 'blocks.json');

function loadIR(name: string): EntryIR {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as EntryIR;
}

describe.skipIf(!existsSync(CATALOG))('compiler', () => {
  it('validates the entrybot basic IR', () => {
    const ir = loadIR('entrybot-basic.ir.json');
    const result = validateProject(ir);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects unknown block types', () => {
    const ir: EntryIR = {
      objects: [
        {
          name: 'x',
          sprite: 'entrybot',
          scripts: [[{ type: 'when_run_button_click' }, { type: 'not_a_real_block' }]],
        },
      ],
    };
    const result = validateProject(ir);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('not_a_real_block'))).toBe(true);
  });

  it('rejects threads that do not start with a hat', () => {
    const ir: EntryIR = {
      objects: [
        {
          name: 'x',
          sprite: 'entrybot',
          scripts: [[{ type: 'move_direction' }]],
        },
      ],
    };
    const result = validateProject(ir);
    expect(result.valid).toBe(false);
  });

  it('compiles entrybot IR to semantically equivalent project script', () => {
    const ir = loadIR('entrybot-basic.ir.json');
    const project = compileProject(ir);
    const script = project.objects[0].script as unknown[][];

    expect(script).toHaveLength(1);
    const thread = script[0] as Array<Record<string, unknown>>;
    expect(thread[0].type).toBe('when_run_button_click');
    expect(thread[0].x).toBe(40);
    expect(thread[0].y).toBe(50);

    expect(thread[1].type).toBe('repeat_basic');
    const statements = thread[1].statements as unknown[][];
    expect(statements).toHaveLength(1);
    expect((statements[0][0] as { type: string }).type).toBe('move_direction');
  });

  it('compiles named params into positional arrays', () => {
    const ir = loadIR('bounce-cat.ir.json');
    const project = compileProject(ir);
    const thread = (project.objects[0].script as unknown[][])[0] as Array<
      Record<string, unknown>
    >;
    const repeat = thread[1];
    const params = repeat.params as unknown[];
    // VALUE at index 0 should be number block with 4
    expect(params[0]).toEqual({ type: 'number', params: ['4'] });
    expect(params[1]).toBeNull(); // Indicator

    const body = (repeat.statements as unknown[][])[0] as Array<Record<string, unknown>>;
    expect(body[0].type).toBe('move_direction');
    expect((body[0].params as unknown[])[0]).toEqual({ type: 'number', params: ['10'] });
    expect(body[1].type).toBe('bounce_wall');
  });

  it('gives every object, picture and sound a unique id', () => {
    const thread = [{ type: 'when_run_button_click' }];
    const project = compileProject({
      objects: [
        { name: 'A', sprite: 'entrybot', scripts: [thread] },
        { name: 'B', sprite: 'entrybot', scripts: [thread] },
        { name: 'C', sprite: 'entrybot', scripts: [thread] },
      ],
    });

    const ids: string[] = [
      ...project.scenes.map((s) => s.id),
      ...project.variables.map((v) => String(v.id)),
    ];
    for (const obj of project.objects as Array<Record<string, any>>) {
      ids.push(obj.id);
      ids.push(...obj.sprite.pictures.map((p: { id: string }) => p.id));
      ids.push(...obj.sprite.sounds.map((s: { id: string }) => s.id));
      // selectedPictureId must point at one of this object's own pictures
      expect(obj.sprite.pictures.map((p: { id: string }) => p.id)).toContain(
        obj.selectedPictureId,
      );
    }

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('throws CompileError on invalid IR', () => {
    expect(() =>
      compileProject({
        objects: [
          {
            name: 'x',
            sprite: 'entrybot',
            scripts: [[{ type: 'nope' }]],
          },
        ],
      }),
    ).toThrow(CompileError);
  });
});

describe.skipIf(!existsSync(join(ROOT, 'vendor', 'entryjs', 'images', 'media')))(
  'ent packing',
  () => {
    const outDir = join(ROOT, 'output', 'test');

    it('packs a valid tar.gz .ent with temp/project.json', async () => {
      mkdirSync(outDir, { recursive: true });
      const ir = loadIR('entrybot-basic.ir.json');
      const project = compileProject(ir);
      const entPath = join(outDir, 'entrybot-basic.ent');

      await packEnt(project, { outputPath: entPath });
      expect(existsSync(entPath)).toBe(true);

      const extractDir = join(outDir, 'extract');
      rmSync(extractDir, { recursive: true, force: true });
      mkdirSync(extractDir, { recursive: true });

      await tar.x({ file: entPath, cwd: extractDir });

      const projectJson = join(extractDir, 'temp', 'project.json');
      expect(existsSync(projectJson)).toBe(true);
      expect(existsSync(join(extractDir, 'temp', 'media', 'entrybot1.svg'))).toBe(true);

      const loaded = JSON.parse(readFileSync(projectJson, 'utf8'));
      expect(typeof loaded.objects[0].script).toBe('string');
      const script = JSON.parse(loaded.objects[0].script);
      expect(script[0][0].type).toBe('when_run_button_click');
    });
  },
);
