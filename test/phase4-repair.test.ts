/**
 * Phase 4-1 repair_project tests.
 *
 * Covers deterministic repairs, opt-in semantic additions, dry-run
 * immutability, idempotence, and safe failure for malformed IR.
 */
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { repairProject } from '../compiler/repair.ts';
import type { EntryIR } from '../src/types/ir.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = join(ROOT, 'catalog', 'blocks.json');
const SOUND = 'assets/media/bark.mp3';
const OBJECTS_ERROR = 'ir.objects must be a non-empty array';

function baseObject(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name: '봇',
    sprite: 'entrybot',
    scripts: [[{ type: 'when_run_button_click' }]],
    ...overrides,
  };
}

function repairedIR(result: ReturnType<typeof repairProject>): EntryIR {
  return result.repairedIR as EntryIR;
}

function semanticFixture(): Record<string, unknown> {
  return {
    objects: [
      {
        name: '봇',
        sprite: 'entrybot',
        scene: '게임',
        scripts: [
          [
            { type: 'when_run_button_click' },
            { type: 'set_variable', params: { VARIABLE: '점수', VALUE: 1 } },
            {
              type: 'add_value_to_list',
              params: { VALUE: '항목', LIST: '목록' },
            },
            { type: 'message_cast', params: { VALUE: '시작' } },
          ],
        ],
      },
    ],
  };
}

describe.skipIf(!existsSync(CATALOG))('repairProject', () => {
  it('leaves a valid IR unchanged and defaults to dryRun', () => {
    const input = { objects: [baseObject()] };
    const result = repairProject(input);

    expect(result.ok).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.changes).toEqual([]);
    expect(result.repairedIR).toEqual(input);
    expect(result.ok).toBe(result.validation.valid);
    expect(result.remainingErrors).toBe(result.validation.errors);
  });

  it('removes duplicate variables and warns when their values differ', () => {
    const input = {
      objects: [baseObject()],
      variables: [
        { name: '점수', initialValue: 0 },
        { name: '점수', initialValue: 1 },
      ],
    };

    const result = repairProject(input);

    expect(result.ok).toBe(true);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({
      path: 'variables[1]',
      action: 'remove',
      before: { name: '점수', initialValue: 1 },
    });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('점수');
    expect(repairedIR(result).variables).toEqual([
      { name: '점수', initialValue: 0 },
    ]);
  });

  it('does not delete non-identical duplicate objects', () => {
    const input = {
      objects: [
        baseObject(),
        baseObject({
          scripts: [
            [
              { type: 'when_run_button_click' },
              { type: 'move_direction', params: { VALUE: 10 } },
            ],
          ],
        }),
      ],
    };

    const result = repairProject(input);

    expect(result.ok).toBe(false);
    expect(result.changes).toEqual([]);
    expect(result.remainingErrors.some((e) => e.includes('duplicate object name'))).toBe(
      true,
    );
    expect(repairedIR(result).objects).toHaveLength(2);
  });

  it('cleans text objects without guessing their content', () => {
    const input = {
      objects: [
        {
          name: '안내',
          kind: 'text',
          text: '게임 시작!',
          sprite: 'entrybot',
          pictures: [],
          sounds: [{ path: SOUND, duration: 0 }],
        },
      ],
    };

    const result = repairProject(input);
    const textObject = repairedIR(result).objects[0];

    expect(result.ok).toBe(true);
    expect(result.changes.map((c) => c.path)).toEqual([
      'objects[0].sprite',
      'objects[0].pictures',
      'objects[0].scripts',
      'objects[0].sounds[0].duration',
    ]);
    expect(textObject.sprite).toBeUndefined();
    expect(textObject.pictures).toBeUndefined();
    expect(textObject.scripts).toEqual([]);
    expect(textObject.sounds?.[0]).toEqual({ path: SOUND });
    expect(textObject.sounds?.[0]?.duration).toBeUndefined();
  });

  it('removes empty script threads', () => {
    const input = {
      objects: [
        baseObject({
          scripts: [
            [],
            [
              { type: 'when_run_button_click' },
              { type: 'move_direction', params: { VALUE: 10 } },
            ],
          ],
        }),
      ],
    };

    const result = repairProject(input);

    expect(result.ok).toBe(true);
    expect(result.changes.map((c) => c.path)).toEqual(['objects[0].scripts[0]']);
    expect(repairedIR(result).objects[0].scripts).toEqual([
      [
        { type: 'when_run_button_click' },
        { type: 'move_direction', params: { VALUE: 10 } },
      ],
    ]);
  });

  it('removes an invalid speed instead of guessing one', () => {
    const input = { speed: 0, objects: [baseObject()] };
    const result = repairProject(input);
    const repaired = repairedIR(result) as Record<string, unknown>;

    expect(result.ok).toBe(true);
    expect(result.changes.map((c) => c.path)).toEqual(['speed']);
    expect('speed' in repaired).toBe(false);
  });

  it('repairs function body and invalid function type', () => {
    const input = {
      objects: [baseObject()],
      functions: [
        { name: '한 걸음', type: 'bogus', body: 'not-an-array' },
      ],
    };

    const result = repairProject(input);
    const fn = repairedIR(result).functions?.[0];

    expect(result.ok).toBe(true);
    expect(result.changes.map((c) => c.path)).toEqual([
      'functions[0].body',
      'functions[0].type',
    ]);
    expect(fn).toEqual({
      name: '한 걸음',
      type: 'statement',
      body: [],
    });
    expect(fn && 'returnValue' in fn).toBe(false);
  });

  it('removes invalid sound durations', () => {
    const input = { objects: [baseObject({ sounds: [{ path: SOUND, duration: -1 }] })] };
    const result = repairProject(input);
    const sound = repairedIR(result).objects[0].sounds?.[0];

    expect(result.ok).toBe(true);
    expect(result.changes.map((c) => c.path)).toEqual([
      'objects[0].sounds[0].duration',
    ]);
    expect(sound).toEqual({ path: SOUND });
  });

  it('leaves semantic references untouched when opt-in is off', () => {
    const result = repairProject(semanticFixture());

    expect(result.ok).toBe(false);
    expect(result.changes).toEqual([]);
    expect(result.remainingErrors.some((e) => e.includes('unknown scene'))).toBe(
      true,
    );
    expect(
      result.remainingErrors.some((e) => e.includes('unknown variable')),
    ).toBe(true);
    expect(result.remainingErrors.some((e) => e.includes('unknown list'))).toBe(
      true,
    );
    expect(
      result.remainingErrors.some((e) => e.includes('unknown message')),
    ).toBe(true);
  });

  it('adds missing scenes, variables, lists, and messages when opt-in is on', () => {
    const result = repairProject(semanticFixture(), {
      policy: { allowSemanticAdditions: true },
    });
    const ir = repairedIR(result);

    expect(result.ok).toBe(true);
    expect(result.changes.map((c) => c.path)).toEqual([
      'scenes[0]',
      'scenes[1]',
      'variables[0]',
      'lists[0]',
      'messages[0]',
    ]);
    expect(ir.scenes).toEqual([{ name: '장면 1' }, { name: '게임' }]);
    expect(ir.variables).toEqual([{ name: '점수', initialValue: 0 }]);
    expect(ir.lists).toEqual([{ name: '목록', initialValues: [] }]);
    expect(ir.messages).toEqual([{ name: '시작' }]);
  });

  it('never mutates the input and returns the same proposal for dry and wet runs', () => {
    const input = {
      ...baseObject({
        speed: 0,
        pictures: [],
        scripts: [
          [],
          [
            { type: 'when_run_button_click' },
            { type: 'move_direction', params: { VALUE: 10 } },
          ],
        ],
      }),
      variables: [
        { name: '점수', initialValue: 0 },
        { name: '점수', initialValue: 1 },
      ],
    };
    const before = structuredClone(input);

    const dry = repairProject(input);
    const wet = repairProject(input, { dryRun: false });

    expect(input).toEqual(before);
    expect(dry.dryRun).toBe(true);
    expect(wet.dryRun).toBe(false);
    expect(dry.repairedIR).toEqual(wet.repairedIR);
    expect(dry.changes).toEqual(wet.changes);
  });

  it('is idempotent after a successful repair', () => {
    const messy = {
      speed: 0,
      objects: [
        {
          name: '봇',
          sprite: 'entrybot',
          scene: '게임',
          pictures: [],
          sounds: [{ path: SOUND, duration: 0 }],
          scripts: [
            [],
            [
              { type: 'when_run_button_click' },
              {
                type: 'set_variable',
                params: { VARIABLE: '점수', VALUE: 1 },
              },
            ],
          ],
        },
      ],
      variables: [
        { name: '점수', initialValue: 0 },
        { name: '점수', initialValue: 1 },
      ],
    };

    const first = repairProject(messy, {
      policy: { allowSemanticAdditions: true },
    });
    const second = repairProject(first.repairedIR, {
      policy: { allowSemanticAdditions: true },
    });

    expect(first.ok).toBe(true);
    expect(first.changes.length).toBeGreaterThan(0);
    expect(second.ok).toBe(true);
    expect(second.changes).toEqual([]);
    expect(second.repairedIR).toEqual(first.repairedIR);
  });

  it('returns a safe failure for malformed IR instead of throwing', () => {
    const cases: unknown[] = [
      null,
      undefined,
      42,
      'x',
      [],
      {},
      { objects: [] },
      { objects: 'no' },
    ];

    for (const input of cases) {
      const result = repairProject(input);
      expect(result.ok).toBe(false);
      expect(result.remainingErrors).toEqual([OBJECTS_ERROR]);
      expect(result.validation.errors).toEqual(result.remainingErrors);
      expect(result.repairedIR).toBe(input);
    }

    const badObject = repairProject({ objects: [null] });
    expect(badObject.ok).toBe(false);
    expect(badObject.remainingErrors).toEqual([
      'ir.objects[0] must be an object',
    ]);
    expect(badObject.validation.errors).toEqual(badObject.remainingErrors);
  });

  it('preserves unknown blocks and unknown params for the caller to fix', () => {
    const thread = [
      { type: 'when_run_button_click' },
      { type: 'move_direction', params: { VALUE: 10, NOPE: 1 } },
      { type: 'not_a_real_block' },
    ];
    const result = repairProject({ objects: [baseObject({ scripts: [thread] })] });
    const repairedThread = repairedIR(result).objects[0].scripts[0];

    expect(result.ok).toBe(false);
    expect(result.changes).toEqual([]);
    expect(
      result.remainingErrors.some((e) => e.includes('not_a_real_block')),
    ).toBe(true);
    expect(result.remainingErrors.some((e) => e.includes('NOPE'))).toBe(true);
    expect(repairedThread[1]?.params).toEqual({ VALUE: 10, NOPE: 1 });
    expect(repairedThread[2]?.type).toBe('not_a_real_block');
  });
});
