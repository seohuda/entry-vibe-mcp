import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as tar from 'tar';
import { compileProject, CompileError } from '../compiler/compile.ts';
import { decompileProject } from '../compiler/decompile.ts';
import { simulateProject } from '../compiler/runtime-sim.ts';
import { smokeTestProject } from '../compiler/smoke.ts';
import { verifyProject } from '../compiler/verify.ts';
import { unpackEnt } from '../compiler/unpack.ts';
import { validateProject } from '../compiler/validate.ts';
import { packEnt, packPrepared, prepareExport, writePreparedJson } from '../compiler/pack.ts';
import { ENTRYBOT_MEDIA_FILES, type EntryProject } from '../compiler/skeleton.ts';
import { auditCompiledProject } from '../compiler/audit-export.ts';
import { mediaDir } from '../src/paths.ts';
import type { EntryIR } from '../src/types/ir.ts';
import { addObject, patchScript, removeObject } from '../server/ir-edit.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = join(ROOT, 'test', 'fixtures');
const CATALOG = join(ROOT, 'catalog', 'blocks.json');

function loadIR(name: string): EntryIR {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as EntryIR;
}

function irWithParamValue(value: unknown): EntryIR {
  return {
    objects: [
      {
        name: 'x',
        sprite: 'entrybot',
        scripts: [
          [
            { type: 'when_run_button_click' },
            { type: 'move_direction', params: { VALUE: value } },
          ],
        ],
      },
    ],
  } as unknown as EntryIR;
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

  it('rejects function definition hats as a script thread opener', () => {
    // function_create is isHat, but it heads a function definition rather than
    // an object script, so Entry would not accept it here.
    const result = validateProject({
      objects: [
        {
          name: 'x',
          sprite: 'entrybot',
          scripts: [[{ type: 'function_create' }, { type: 'move_direction' }]],
        },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('event block'))).toBe(true);
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
    expect(project.aiUtilizeBlocks).toEqual([]);
    expect(project.expansionBlocks).toEqual([]);
  });

  it('fills aiUtilizeBlocks when TTS blocks are used', () => {
    const catalog = JSON.parse(readFileSync(CATALOG, 'utf8')) as {
      blocks: Array<{ type: string; extension?: { kind: string; module: string } }>;
    };
    const tts = catalog.blocks.find((b) => b.type === 'read_text');
    if (!tts?.extension) return; // older catalog without AI blocks

    const project = compileProject({
      objects: [
        {
          name: 'TTS',
          sprite: 'entrybot',
          scripts: [
            [
              { type: 'when_run_button_click' },
              { type: 'read_text', params: { TEXT: '안녕' } },
            ],
          ],
        },
      ],
    });
    expect(project.aiUtilizeBlocks).toEqual(['tts']);
  });

  it('compiles messages and rewrites VALUE to message ids', () => {
    const ir = JSON.parse(
      readFileSync(join(ROOT, 'examples', 'message-ping.ir.json'), 'utf8'),
    ) as EntryIR;
    const result = validateProject(ir);
    expect(result.valid, result.errors.join('\n')).toBe(true);
    const project = compileProject(ir);
    expect(project.messages).toHaveLength(1);
    expect(project.messages![0].name).toBe('시작');
    const msgId = project.messages![0].id;
    const sender = (project.objects[0].script as unknown[][])[0] as Array<
      Record<string, unknown>
    >;
    expect(sender[1].type).toBe('message_cast');
    expect((sender[1].params as unknown[])[0]).toBe(msgId);
    const receiver = (project.objects[1].script as unknown[][])[0] as Array<
      Record<string, unknown>
    >;
    expect(receiver[0].type).toBe('when_message_cast');
    expect((receiver[0].params as unknown[])[1]).toBe(msgId);
    expect((project.objects[0].entity as { x: number }).x).toBe(-120);
  });

  it('compiles function-list (lists + functions + show_list)', () => {
    const ir = JSON.parse(
      readFileSync(join(ROOT, 'examples', 'function-list.ir.json'), 'utf8'),
    ) as EntryIR;
    const result = validateProject(ir);
    expect(result.valid, result.errors.join('\n')).toBe(true);
    const project = compileProject(ir);
    expect(project.functions).toHaveLength(1);
    const thread = (project.objects[0].script as unknown[][])[0] as Array<
      Record<string, unknown>
    >;
    expect(thread[1].type).toBe('show_list');
    expect(thread[2].type).toBe('repeat_basic');
  });

  it('compiles functions and function_call into func_<id>', () => {
    const ir = JSON.parse(
      readFileSync(join(ROOT, 'examples', 'function-double.ir.json'), 'utf8'),
    ) as EntryIR;
    const result = validateProject(ir);
    expect(result.valid, result.errors.join('\n')).toBe(true);
    const project = compileProject(ir);
    expect(project.functions).toHaveLength(1);
    const fn = project.functions![0] as { id: string; content: string };
    expect(fn.content).toContain('function_create');
    expect(fn.content).toContain('한 걸음');
    const thread = (project.objects[0].script as unknown[][])[0] as Array<
      Record<string, unknown>
    >;
    expect(thread[1].type).toBe(`func_${fn.id}`);
    expect(thread[2].type).toBe(`func_${fn.id}`);
  });

  it('returns hints when validation fails', () => {
    const result = validateProject({
      objects: [
        {
          name: 'x',
          sprite: 'entrybot',
          scripts: [[{ type: 'move_direction' }]],
        },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.hints.length).toBe(result.errors.length);
    expect(result.hints.some((h) => /when_run_button_click|event/i.test(h))).toBe(true);
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

  it('resolves VARIABLE params from name to the generated variable id', () => {
    const ir: EntryIR = {
      objects: [
        {
          name: 'x',
          sprite: 'entrybot',
          scripts: [
            [
              { type: 'when_run_button_click' },
              { type: 'set_variable', params: { VARIABLE: '점수', VALUE: 10 } },
            ],
          ],
        },
      ],
      variables: [{ name: '점수', initialValue: 0 }],
    };

    expect(validateProject(ir).valid).toBe(true);

    const project = compileProject(ir);
    const declared = project.variables.find((v) => v.name === '점수')!;
    expect(declared).toBeDefined();

    const thread = (project.objects[0].script as unknown[][])[0] as Array<
      Record<string, unknown>
    >;
    const params = thread[1].params as unknown[];
    expect(params[0]).toBe(declared.id);
    expect(params[0]).not.toBe('점수');
  });

  it('rejects references to undeclared variables', () => {
    const result = validateProject({
      objects: [
        {
          name: 'x',
          sprite: 'entrybot',
          scripts: [
            [
              { type: 'when_run_button_click' },
              { type: 'set_variable', params: { VARIABLE: '없는변수', VALUE: 1 } },
            ],
          ],
        },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('없는변수'))).toBe(true);
  });

  it('rejects duplicate variable names', () => {
    const result = validateProject({
      objects: [
        { name: 'x', sprite: 'entrybot', scripts: [[{ type: 'when_run_button_click' }]] },
      ],
      variables: [
        { name: '점수', initialValue: 0 },
        { name: '점수', initialValue: 1 },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('duplicate'))).toBe(true);
  });

  it('resolves LIST params from name to the generated list id', () => {
    const ir: EntryIR = {
      objects: [
        {
          name: 'x',
          sprite: 'entrybot',
          scripts: [
            [
              { type: 'when_run_button_click' },
              { type: 'add_value_to_list', params: { VALUE: 10, LIST: '점수판' } },
            ],
          ],
        },
      ],
      lists: [{ name: '점수판', initialValues: [1, 2, 3] }],
    };

    expect(validateProject(ir).valid).toBe(true);

    const project = compileProject(ir);
    const declared = project.variables.find((v) => v.name === '점수판')!;
    expect(declared).toBeDefined();
    expect(declared.variableType).toBe('list');
    expect(declared.array).toEqual([{ data: '1' }, { data: '2' }, { data: '3' }]);

    const thread = (project.objects[0].script as unknown[][])[0] as Array<
      Record<string, unknown>
    >;
    const params = thread[1].params as unknown[];
    expect(params[1]).toBe(declared.id);
    expect(params[1]).not.toBe('점수판');
  });

  it('rejects references to undeclared lists', () => {
    const result = validateProject({
      objects: [
        {
          name: 'x',
          sprite: 'entrybot',
          scripts: [
            [
              { type: 'when_run_button_click' },
              { type: 'add_value_to_list', params: { VALUE: 1, LIST: '없는리스트' } },
            ],
          ],
        },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('없는리스트'))).toBe(true);
  });

  it('rejects duplicate list names', () => {
    const result = validateProject({
      objects: [
        { name: 'x', sprite: 'entrybot', scripts: [[{ type: 'when_run_button_click' }]] },
      ],
      lists: [
        { name: '점수판', initialValues: [] },
        { name: '점수판', initialValues: [] },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('duplicate'))).toBe(true);
  });

  it('rejects duplicate object names', () => {
    const result = validateProject({
      objects: [
        { name: 'x', sprite: 'entrybot', scripts: [[{ type: 'when_run_button_click' }]] },
        { name: 'x', sprite: 'entrybot', scripts: [[{ type: 'when_run_button_click' }]] },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('duplicate object name'))).toBe(true);
  });

  it('rejects blank or padded declaration names', () => {
    const okObject = {
      name: 'x',
      sprite: 'entrybot' as const,
      scripts: [[{ type: 'when_run_button_click' }]],
    };
    const blankCases: Array<[string, EntryIR]> = [
      ['scenes', { objects: [okObject], scenes: [{ name: '   ' }] }],
      ['variables', { objects: [okObject], variables: [{ name: '   ', initialValue: 0 }] }],
      ['lists', { objects: [okObject], lists: [{ name: '   ', initialValues: [] }] }],
      ['messages', { objects: [okObject], messages: [{ name: '   ' }] }],
      [
        'functions',
        { objects: [okObject], functions: [{ name: '   ', type: 'statement', body: [] }] },
      ],
      ['objects[1]', { objects: [okObject, { ...okObject, name: '   ' }] }],
    ];
    for (const [label, ir] of blankCases) {
      const result = validateProject(ir);
      expect(result.valid, label).toBe(false);
      expect(result.errors.some((e) => e.includes('must not be blank')), label).toBe(true);
    }

    const paddedCases: Array<[string, EntryIR]> = [
      ['scenes', { objects: [okObject], scenes: [{ name: ' 장면 ' }] }],
      ['variables', { objects: [okObject], variables: [{ name: ' 점수 ', initialValue: 0 }] }],
      ['lists', { objects: [okObject], lists: [{ name: ' 목록 ', initialValues: [] }] }],
      ['messages', { objects: [okObject], messages: [{ name: ' 시작 ' }] }],
      [
        'functions',
        { objects: [okObject], functions: [{ name: ' 함수 ', type: 'statement', body: [] }] },
      ],
      ['objects[1]', { objects: [okObject, { ...okObject, name: ' 오브젝트 ' }] }],
    ];
    for (const [label, ir] of paddedCases) {
      const result = validateProject(ir);
      expect(result.valid, label).toBe(false);
      expect(
        result.errors.some((e) => e.includes('must not start or end with whitespace')),
        label,
      ).toBe(true);
    }
  });

  it('rejects garbage param values with a clear error', () => {
    for (const value of [null, [1, 2], { noType: true }]) {
      const result = validateProject(irWithParamValue(value));
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.includes('string, number, boolean, or nested block')),
      ).toBe(true);
    }
  });

  it('rejects nested blocks whose "type" is not a string', () => {
    const result = validateProject(irWithParamValue({ type: 7, params: {} }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('nested block'))).toBe(true);
  });

  it('rejects non-string values for Dropdown/DropdownDynamic/Keyboard params', () => {
    const ir = {
      objects: [
        {
          name: 'x',
          sprite: 'entrybot',
          scripts: [
            [
              { type: 'when_run_button_click' },
              { type: 'message_cast', params: { VALUE: 7 } },
            ],
          ],
        },
      ],
      messages: [{ name: '시작' }],
    } as unknown as EntryIR;
    const result = validateProject(ir);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('must be a string'))).toBe(true);
  });

  it('accepts an empty statement slot', () => {
    const ir: EntryIR = {
      objects: [
        {
          name: 'x',
          sprite: 'entrybot',
          scripts: [
            [
              { type: 'when_run_button_click' },
              { type: 'repeat_basic', params: { VALUE: 2 }, statements: { DO: [] } },
            ],
          ],
        },
      ],
    };
    expect(validateProject(ir)).toEqual({ valid: true, errors: [], hints: [] });

    const thread = (compileProject(ir).objects[0].script as unknown[][])[0] as Array<
      Record<string, unknown>
    >;
    expect(thread[1].statements).toEqual([[]]);
  });

  it('still requires top-level script threads to be non-empty', () => {
    const result = validateProject({
      objects: [{ name: 'x', sprite: 'entrybot', scripts: [[]] }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('non-empty'))).toBe(true);
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

describe('ent packing', () => {
  const outDir = join(ROOT, 'output', 'test');

  it('ships every media file .ent packing requires', () => {
    // Regression guard: these used to live only in gitignored vendor/, so a
    // fresh clone or npm install could not compile a .ent at all.
    for (const file of ENTRYBOT_MEDIA_FILES) {
      expect(existsSync(join(mediaDir(), file)), file).toBe(true);
    }
  });

  it('packs a valid tar.gz .ent with hash-layout assets', async () => {
    mkdirSync(outDir, { recursive: true });
    const ir = loadIR('entrybot-basic.ir.json');
    const project = compileProject(ir);
    const entPath = join(outDir, 'entrybot-basic.ent');
    const jsonPath = join(outDir, 'entrybot-basic.json');

    let seq = 0;
    const createFileId = () => `abcd${String(++seq).padStart(28, '0')}`;
    const prepared = prepareExport(project, { createFileId });
    writePreparedJson(prepared, jsonPath);
    await packPrepared(prepared, { outputPath: entPath });
    expect(existsSync(entPath)).toBe(true);

    const extractDir = join(outDir, 'extract');
    rmSync(extractDir, { recursive: true, force: true });
    mkdirSync(extractDir, { recursive: true });

    await tar.x({ file: entPath, cwd: extractDir });

    const projectJson = join(extractDir, 'temp', 'project.json');
    expect(existsSync(projectJson)).toBe(true);

    const loaded = JSON.parse(readFileSync(projectJson, 'utf8'));
    const sidecar = JSON.parse(readFileSync(jsonPath, 'utf8'));
    expect(loaded.name).toBeTruthy();
    // Sidecar JSON and .ent project.json must share the same media file ids.
    expect(sidecar.objects[0].sprite.pictures[0].filename).toBe(
      loaded.objects[0].sprite.pictures[0].filename,
    );
    expect(typeof loaded.objects[0].script).toBe('string');
    const script = JSON.parse(loaded.objects[0].script);
    expect(script[0][0].type).toBe('when_run_button_click');

    const pictures = loaded.objects[0].sprite.pictures;
    const sounds = loaded.objects[0].sprite.sounds;
    expect(pictures).toHaveLength(2);
    expect(sounds).toHaveLength(1);

    for (const picture of pictures) {
      expect(picture.filename).toMatch(/^[0-9a-f]{32}$/);
      expect(picture.fileurl).toBe(
        `temp/${picture.filename.slice(0, 2)}/${picture.filename.slice(2, 4)}/image/${picture.filename}.svg`,
      );
      expect(
        existsSync(
          join(
            extractDir,
            'temp',
            picture.filename.slice(0, 2),
            picture.filename.slice(2, 4),
            'image',
            `${picture.filename}.svg`,
          ),
        ),
      ).toBe(true);
      expect(
        existsSync(
          join(
            extractDir,
            'temp',
            picture.filename.slice(0, 2),
            picture.filename.slice(2, 4),
            'thumb',
            `${picture.filename}.png`,
          ),
        ),
      ).toBe(true);
    }

    const sound = sounds[0];
    expect(sound.filename).toMatch(/^[0-9a-f]{32}$/);
    expect(
      existsSync(
        join(
          extractDir,
          'temp',
          sound.filename.slice(0, 2),
          sound.filename.slice(2, 4),
          'sound',
          `${sound.filename}.mp3`,
        ),
      ),
    ).toBe(true);

    // Flat temp/media/ layout must not be used — playentry.org rejects it.
    expect(existsSync(join(extractDir, 'temp', 'media'))).toBe(false);
  });

  it('sets a project name so playentry.org does not show undefined', () => {
    const project = compileProject(loadIR('bounce-cat.ir.json'));
    expect(project.name).toBe('고양이 프로젝트');
    const prepared = prepareExport(project);
    expect(prepared.project.name).toBe('고양이 프로젝트');
    expect(prepared.assets.some((a) => a.kind === 'picture')).toBe(true);
  });

  it('does not let concurrent packs clobber each other', async () => {
    mkdirSync(outDir, { recursive: true });
    const project = compileProject(loadIR('entrybot-basic.ir.json'));
    const paths = [0, 1, 2, 3].map((i) => join(outDir, `concurrent-${i}.ent`));

    await Promise.all(paths.map((outputPath) => packEnt(project, { outputPath })));

    for (const p of paths) {
      expect(existsSync(p), p).toBe(true);
    }
    // every staging dir must be cleaned up
    expect(readdirSync(outDir).filter((f) => f.startsWith('.ent-staging-'))).toEqual([]);
  });
});

describe.skipIf(!existsSync(CATALOG))('host assets/', () => {
  const assetRoot = join(FIXTURES, 'assets');
  const prev = process.env.ENTRY_VIBE_ASSETS_DIR;

  beforeAll(() => {
    process.env.ENTRY_VIBE_ASSETS_DIR = assetRoot;
  });

  afterAll(() => {
    if (prev === undefined) delete process.env.ENTRY_VIBE_ASSETS_DIR;
    else process.env.ENTRY_VIBE_ASSETS_DIR = prev;
  });

  it('rejects missing or escaping picture paths', () => {
    const missing = validateProject({
      objects: [
        {
          name: 'x',
          sprite: 'entrybot',
          pictures: [{ path: 'assets/nope.png' }],
          scripts: [[{ type: 'when_run_button_click' }]],
        },
      ],
    });
    expect(missing.valid).toBe(false);
    expect(missing.errors.some((e) => e.includes('not found'))).toBe(true);

    const escape = validateProject({
      objects: [
        {
          name: 'x',
          sprite: 'entrybot',
          pictures: [{ path: 'assets/../secret.png' }],
          scripts: [[{ type: 'when_run_button_click' }]],
        },
      ],
    });
    expect(escape.valid).toBe(false);
    expect(escape.errors.some((e) => e.includes('escapes') || e.includes('.png or .svg'))).toBe(
      true,
    );
  });

  it('compiles and packs custom png/svg costumes from assets/', async () => {
    const ir: EntryIR = {
      objects: [
        {
          name: '점',
          sprite: 'entrybot',
          pictures: [
            { name: '점', path: 'assets/dot.png' },
            { path: 'assets/blob.svg' },
          ],
          scripts: [[{ type: 'when_run_button_click' }, { type: 'move_direction' }]],
        },
      ],
    };
    expect(validateProject(ir).valid).toBe(true);

    const project = compileProject(ir);
    const sprite = project.objects[0].sprite as {
      pictures: Array<{ fileurl: string; imageType: string; name: string }>;
    };
    expect(sprite.pictures).toHaveLength(2);
    expect(sprite.pictures[0].fileurl).toMatch(/^host-asset:/);
    expect(sprite.pictures[0].imageType).toBe('png');
    expect(sprite.pictures[1].imageType).toBe('svg');
    expect(sprite.pictures[1].name).toBe('blob');

    const entity = project.objects[0].entity as { scaleX: number; scaleY: number };
    expect(entity.scaleX).toBe(1);
    expect(entity.scaleY).toBe(1);
    const outDir = join(ROOT, 'output', 'test');
    mkdirSync(outDir, { recursive: true });
    const entPath = join(outDir, 'custom-assets.ent');
    let seq = 0;
    const prepared = prepareExport(project, {
      createFileId: () => `face${String(++seq).padStart(28, '0')}`,
    });
    await packPrepared(prepared, { outputPath: entPath });

    const extractDir = join(outDir, 'custom-extract');
    rmSync(extractDir, { recursive: true, force: true });
    mkdirSync(extractDir, { recursive: true });
    await tar.x({ file: entPath, cwd: extractDir });

    const loaded = JSON.parse(readFileSync(join(extractDir, 'temp', 'project.json'), 'utf8'));
    const pics = loaded.objects[0].sprite.pictures;
    expect(pics[0].imageType).toBe('png');
    expect(pics[0].fileurl).toContain('/image/');
    expect(pics[0].fileurl.endsWith('.png')).toBe(true);
    expect(
      existsSync(
        join(
          extractDir,
          'temp',
          pics[0].filename.slice(0, 2),
          pics[0].filename.slice(2, 4),
          'image',
          `${pics[0].filename}.png`,
        ),
      ),
    ).toBe(true);
    expect(
      existsSync(
        join(
          extractDir,
          'temp',
          pics[1].filename.slice(0, 2),
          pics[1].filename.slice(2, 4),
          'image',
          `${pics[1].filename}.svg`,
        ),
      ),
    ).toBe(true);
  });

  it('compiles and packs a custom mp3 from assets/', async () => {
    const ir: EntryIR = {
      objects: [
        {
          name: '스피커',
          sprite: 'entrybot',
          sounds: [{ name: '커스텀', path: 'assets/custom-bark.mp3', duration: 1.3 }],
          scripts: [
            [{ type: 'when_run_button_click' }, { type: 'sound_something_with_block' }],
          ],
        },
      ],
    };
    expect(validateProject(ir).valid).toBe(true);
    const project = compileProject(ir);
    const sounds = (
      project.objects[0].sprite as { sounds: Array<{ fileurl: string; name: string }> }
    ).sounds;
    expect(sounds).toHaveLength(1);
    expect(sounds[0].fileurl).toMatch(/^host-asset:/);
    expect(sounds[0].name).toBe('커스텀');

    const outDir = join(ROOT, 'output', 'test');
    mkdirSync(outDir, { recursive: true });
    const entPath = join(outDir, 'custom-sound.ent');
    const prepared = prepareExport(project);
    await packPrepared(prepared, { outputPath: entPath });

    const extractDir = join(outDir, 'custom-sound-extract');
    rmSync(extractDir, { recursive: true, force: true });
    mkdirSync(extractDir, { recursive: true });
    await tar.x({ file: entPath, cwd: extractDir });

    const loaded = JSON.parse(readFileSync(join(extractDir, 'temp', 'project.json'), 'utf8'));
    const packed = loaded.objects[0].sprite.sounds[0];
    expect(packed.filename).toMatch(/^[0-9a-f]{32}$/);
    expect(
      existsSync(
        join(
          extractDir,
          'temp',
          packed.filename.slice(0, 2),
          packed.filename.slice(2, 4),
          'sound',
          `${packed.filename}.mp3`,
        ),
      ),
    ).toBe(true);
  });

  it('compiles multi-scene IR with background objects', () => {
    const assets = join(FIXTURES, 'assets');
    process.env.ENTRY_VIBE_ASSETS_DIR = assets;
    try {
      const ir: EntryIR = {
        scenes: [
          { name: '시작', background: { path: 'assets/dot.png', name: '배경' } },
          { name: '게임' },
        ],
        objects: [
          {
            name: '플레이어',
            sprite: 'entrybot',
            scene: '게임',
            scripts: [[{ type: 'when_run_button_click' }]],
          },
        ],
      };
      expect(validateProject(ir).valid).toBe(true);
      const project = compileProject(ir);
      expect(project.scenes).toHaveLength(2);
      expect(project.objects.length).toBeGreaterThanOrEqual(2);
      const bg = project.objects.find((o) => o.lock === true);
      expect(bg).toBeDefined();
      expect(bg?.scene).toBe(project.scenes.find((s) => s.name === '시작')?.id);
    } finally {
      delete process.env.ENTRY_VIBE_ASSETS_DIR;
    }
  });

  it('compiles text box objects', () => {
    const ir: EntryIR = {
      objects: [
        {
          name: '안내',
          kind: 'text',
          text: '게임 시작!',
          x: 10,
          y: -100,
          scripts: [],
        },
        {
          name: '봇',
          sprite: 'entrybot',
          scripts: [[{ type: 'when_run_button_click' }]],
        },
      ],
    };
    expect(validateProject(ir).valid).toBe(true);
    const project = compileProject(ir);
    const textObj = project.objects.find((o) => o.objectType === 'textBox');
    expect(textObj?.name).toBe('안내');
    expect((textObj?.entity as { text: string }).text).toBe('게임 시작!');
  });

  it('smoke test passes for valid IR', () => {
    const ir = loadIR('entrybot-basic.ir.json');
    const smoke = smokeTestProject(ir);
    expect(smoke.ok).toBe(true);
    expect(smoke.checks.some((c) => c.name === 'compile_project' && c.ok)).toBe(true);
  });

  it('round-trips compile → pack → unpack → decompile for entrybot IR', async () => {
    const roundtripDir = join(ROOT, 'output', 'test');
    mkdirSync(roundtripDir, { recursive: true });
    const ir = loadIR('entrybot-basic.ir.json');
    const project = compileProject(ir);
    const entPath = join(roundtripDir, 'roundtrip.ent');
    const prepared = prepareExport(project);
    await packPrepared(prepared, { outputPath: entPath });

    const { project: unpacked, media } = await unpackEnt(entPath);
    const { ir: decoded, warnings } = decompileProject(unpacked, { media });
    expect(warnings.length).toBeLessThan(5);
    expect(decoded.objects[0].scripts[0][0].type).toBe('when_run_button_click');
    expect(decoded.objects[0].scripts[0][1].type).toBe('repeat_basic');
    expect(validateProject(decoded).valid).toBe(true);
  });

  it('add_object and patch_script produce valid IR', () => {
    let ir = loadIR('entrybot-basic.ir.json');
    ir = addObject(ir, {
      name: '추가',
      sprite: 'entrybot',
      scripts: [[{ type: 'when_run_button_click' }, { type: 'move_direction' }]],
    });
    expect(ir.objects).toHaveLength(2);
    ir = patchScript(ir, {
      objectName: '추가',
      threadIndex: 0,
      mode: 'append',
      blocks: [{ type: 'bounce_wall' }],
    });
    const thread = ir.objects[1].scripts[0];
    expect(thread.map((b) => b.type)).toEqual([
      'when_run_button_click',
      'move_direction',
      'bounce_wall',
    ]);
    expect(validateProject(ir).valid).toBe(true);
  });

  it('verify_project runs roundtrip and simulation', async () => {
    const ir = loadIR('entrybot-basic.ir.json');
    const result = await verifyProject(ir);
    expect(result.ok).toBe(true);
    expect(result.checks.some((c) => c.name === 'pack_roundtrip' && c.ok)).toBe(true);
    expect(result.simulation?.stepsExecuted).toBeGreaterThan(0);
  });

  it('simulate_project predicts movement for bounce IR', () => {
    const ir = loadIR('bounce-cat.ir.json');
    const sim = simulateProject(ir);
    expect(sim.objects[0].x).not.toBe(0);
    expect(sim.stepsExecuted).toBeGreaterThan(0);
  });

  it('compiles AI learning IR with project.learning', () => {
    const assets = join(FIXTURES, 'assets');
    process.env.ENTRY_VIBE_ASSETS_DIR = assets;
    try {
      const ir = JSON.parse(
        readFileSync(join(FIXTURES, 'learning-basic.ir.json'), 'utf8'),
      ) as EntryIR;
      expect(validateProject(ir).valid, validateProject(ir).errors.join('\n')).toBe(true);
      const project = compileProject(ir);
      expect(project.learning).toBeDefined();
      expect((project.learning as { type: string }).type).toBe('image');
    } finally {
      delete process.env.ENTRY_VIBE_ASSETS_DIR;
    }
  });

  it('rejects malformed learning labels and tableData', () => {
    const assets = join(FIXTURES, 'assets');
    process.env.ENTRY_VIBE_ASSETS_DIR = assets;
    try {
      const ir = JSON.parse(
        readFileSync(join(FIXTURES, 'learning-basic.ir.json'), 'utf8'),
      ) as EntryIR;
      ir.learning!.labels = ['고양이', '  '];
      const labelsResult = validateProject(ir);
      expect(labelsResult.valid).toBe(false);
      expect(labelsResult.errors.some((e) => e.includes('learning.labels[1]'))).toBe(true);

      ir.learning!.tableData = [1, 2, 3];
      const tableResult = validateProject(ir);
      expect(tableResult.valid).toBe(false);
      expect(tableResult.errors.some((e) => e.includes('learning.tableData'))).toBe(true);
    } finally {
      delete process.env.ENTRY_VIBE_ASSETS_DIR;
    }
  });

  it('remove_object keeps at least one object', () => {
    const ir = JSON.parse(
      readFileSync(join(ROOT, 'examples', 'two-objects.ir.json'), 'utf8'),
    ) as EntryIR;
    const next = removeObject(ir, '방해꾼');
    expect(next.objects).toHaveLength(1);
    expect(validateProject(next).valid).toBe(true);
  });

  it('auditCompiledProject flags missing name and flat media paths', async () => {
    const { auditCompiledProject } = await import('../compiler/audit-export.ts');
    const ir = loadIR('entrybot-basic.ir.json');
    const project = compileProject(ir);
    delete (project as { name?: string }).name;
    const pic = (project.objects[0]!.sprite as { pictures: Array<{ fileurl: string }> })
      .pictures[0]!;
    pic.fileurl = 'temp/media/entrybot1.svg';

    const audit = auditCompiledProject(project);
    expect(audit.ok).toBe(false);
    expect(audit.errors.some((e) => e.includes('name'))).toBe(true);
    expect(audit.errors.some((e) => e.includes('temp/media/'))).toBe(true);
  });

  it('decompiles duplicate warnings only once', () => {
    const project: EntryProject = {
      name: '중복 경고',
      category: '기타',
      scenes: [{ name: '장면 1', id: 's1' }],
      variables: [],
      objects: [
        {
          id: 'o1',
          name: '봇',
          objectType: 'sprite',
          scene: 's1',
          entity: { x: 0, y: 0, direction: 90 },
          sprite: { pictures: [], sounds: [] },
          script: JSON.stringify([
            [
              { type: 'totally_unknown_block', params: [] },
              { type: 'totally_unknown_block', params: [] },
            ],
          ]),
        },
      ],
      expansionBlocks: [],
      aiUtilizeBlocks: [],
      speed: 60,
    };

    const { warnings } = decompileProject(project);
    const unknown = warnings.filter((w) => w.includes('totally_unknown_block'));
    expect(unknown).toHaveLength(1);
    expect(new Set(warnings).size).toBe(warnings.length);
  });

  it('simulates run-button and message threads only', () => {
    const ir: EntryIR = {
      messages: [{ name: '시작' }],
      objects: [
        {
          name: '송신',
          sprite: 'entrybot',
          scripts: [
            [
              { type: 'when_run_button_click' },
              { type: 'message_cast', params: { VALUE: '시작' } },
            ],
          ],
        },
        {
          name: '수신',
          sprite: 'entrybot',
          scripts: [
            [
              { type: 'when_message_cast', params: { VALUE: '시작' } },
              { type: 'move_direction', params: { VALUE: 10 } },
            ],
            [
              { type: 'when_some_key_pressed' },
              { type: 'move_direction', params: { VALUE: 99 } },
            ],
          ],
        },
      ],
    };

    const sim = simulateProject(ir);
    const sender = sim.objects.find((o) => o.name === '송신')!;
    const receiver = sim.objects.find((o) => o.name === '수신')!;
    expect(sender.x).toBe(0);
    expect(receiver.x).toBe(10);
    expect(sim.stepsExecuted).toBeGreaterThanOrEqual(2);
    expect(sim.warnings.some((w) => w.includes('when_some_key_pressed'))).toBe(true);
  });

  it('audits prepared hash media and .ent tar completeness', () => {
    const prepared = prepareExport(compileProject(loadIR('entrybot-basic.ir.json')));
    const clean = auditCompiledProject(prepared.project);
    expect(clean.ok, clean.errors.join('\n')).toBe(true);

    const tarPaths: string[] = [];
    for (const obj of prepared.project.objects) {
      const sprite = obj.sprite as
        | {
            pictures?: Array<{ fileurl?: string; thumbUrl?: string }>;
            sounds?: Array<{ fileurl?: string }>;
          }
        | undefined;
      for (const pic of sprite?.pictures ?? []) {
        if (pic.fileurl) tarPaths.push(pic.fileurl);
        if (pic.thumbUrl) tarPaths.push(pic.thumbUrl);
      }
      for (const sound of sprite?.sounds ?? []) {
        if (sound.fileurl) tarPaths.push(sound.fileurl);
      }
    }
    const complete = auditCompiledProject(prepared.project, { tarPaths });
    expect(complete.ok, complete.errors.join('\n')).toBe(true);

    const missing = auditCompiledProject(prepared.project, { tarPaths: [] });
    expect(missing.ok).toBe(false);
    expect(missing.errors.some((e) => e.includes('missing from .ent archive'))).toBe(true);
  });

  it('audits media filename and host-asset marker mismatches', () => {
    const prepared = prepareExport(compileProject(loadIR('entrybot-basic.ir.json')));
    const picture = (
      prepared.project.objects[0]!.sprite as {
        pictures: Array<{ filename?: string; fileurl?: string }>;
      }
    ).pictures[0]!;
    picture.filename = 'f'.repeat(32);
    const mismatch = auditCompiledProject(prepared.project);
    expect(mismatch.ok).toBe(false);
    expect(mismatch.errors.some((e) => e.includes('does not match filename'))).toBe(true);

    const prepared2 = prepareExport(compileProject(loadIR('entrybot-basic.ir.json')));
    const picture2 = (
      prepared2.project.objects[0]!.sprite as { pictures: Array<{ fileurl?: string }> }
    ).pictures[0]!;
    picture2.fileurl = 'host-asset:assets/entrybot1.svg';
    const host = auditCompiledProject(prepared2.project);
    expect(host.ok).toBe(false);
    expect(host.errors.some((e) => e.includes('host-asset:'))).toBe(true);
  });

  it('audits duplicate and malformed function records', () => {
    const prepared = prepareExport(compileProject(loadIR('entrybot-basic.ir.json')));
    prepared.project.functions = [
      { id: 'f1', content: '[]' },
      { id: 'f1', content: '[]' },
      { id: 'f2', content: 'not-json' },
    ];
    const audit = auditCompiledProject(prepared.project);
    expect(audit.ok).toBe(false);
    expect(audit.errors.some((e) => e.includes('duplicate function id "f1"'))).toBe(true);
    expect(
      audit.errors.some((e) => e.includes('function "f2" content is not valid JSON')),
    ).toBe(true);
  });
});
