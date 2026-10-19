/**
 * Phase 4-2 diff_project tests.
 *
 * The diff operates on in-memory IR values only, so these tests use small
 * synthetic projects and assert paths, kinds, summaries, warnings, media,
 * truncation, malformed-input safety, and input immutability.
 */
import { describe, expect, it } from 'vitest';
import { diffProjects } from '../compiler/diff.ts';

type Plain = Record<string, unknown>;

function objectWith(overrides: Plain = {}): Plain {
  return {
    name: '봇',
    sprite: 'entrybot',
    scripts: [[{ type: 'when_run_button_click' }]],
    ...overrides,
  };
}

function paths(changes: Array<{ path: string }>): string[] {
  return changes.map((change) => change.path);
}

describe('diffProjects', () => {
  it('returns an empty diff for identical IR', () => {
    const project = {
      scenes: [{ name: '장면', background: { path: 'assets/bg.png' } }],
      objects: [
        objectWith({
          pictures: [{ path: 'assets/bot.png' }],
          sounds: [{ path: 'assets/beep.mp3' }],
          scripts: [
            [
              { type: 'when_run_button_click' },
              { type: 'move_direction', params: { VALUE: 10 } },
            ],
          ],
        }),
      ],
      variables: [{ name: '점수', initialValue: 0 }],
      lists: [{ name: '목록', initialValues: ['a'] }],
      messages: [{ name: '시작' }],
      functions: [
        {
          name: 'f',
          type: 'statement',
          body: [{ type: 'move_direction', params: { VALUE: 1 } }],
        },
      ],
      learning: { type: 'number', labels: ['a'] },
      speed: 60,
    };

    const diff = diffProjects(project, structuredClone(project));

    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.modified).toEqual([]);
    expect(diff.warnings).toEqual([]);
    expect(diff.media).toEqual({ added: [], removed: [] });
    expect(diff.truncated).toBe(false);
    expect(diff.omitted).toBe(0);
    expect(diff.summary.added).toBe(0);
    expect(diff.summary.removed).toBe(0);
    expect(diff.summary.modified).toBe(0);
    expect(diff.summary.objects.modified).toBe(0);
    expect(diff.summary.scripts.modified).toBe(0);
    expect(diff.summary.blocks.modified).toBe(0);
    expect(diff.summary.media).toEqual({
      added: 0,
      removed: 0,
      modified: 0,
    });
  });

  it('reports object additions and removals by name', () => {
    const before = { objects: [objectWith()] };
    const addedObject = objectWith({ name: '새것' });
    const after = { objects: [objectWith(), addedObject] };

    const forward = diffProjects(before, after);
    expect(forward.added).toEqual([
      { path: 'objects.새것', kind: 'added', after: addedObject },
    ]);
    expect(forward.summary.added).toBe(1);
    expect(forward.summary.objects.added).toBe(1);

    const backward = diffProjects(after, before);
    expect(backward.removed).toEqual([
      { path: 'objects.새것', kind: 'removed', before: addedObject },
    ]);
    expect(backward.summary.removed).toBe(1);
    expect(backward.summary.objects.removed).toBe(1);
  });

  it('reports modified object fields and order-sensitive arrays', () => {
    const before = {
      objects: [{ name: '봇', x: 0, scripts: [] }],
      lists: [{ name: '목록', initialValues: ['a', 'b'] }],
    };
    const after = {
      objects: [{ name: '봇', x: 10, scripts: [] }],
      lists: [{ name: '목록', initialValues: ['b', 'a'] }],
    };

    const diff = diffProjects(before, after);

    expect(paths(diff.modified)).toEqual([
      'objects.봇.x',
      'lists.목록.initialValues',
    ]);
    expect(diff.modified[0]).toMatchObject({
      kind: 'modified',
      before: 0,
      after: 10,
    });
    expect(diff.summary.modified).toBe(2);
    expect(diff.summary.objects.modified).toBe(1);
    expect(diff.summary.lists.modified).toBe(1);
    expect(diff.summary.added).toBe(0);
  });

  it('reports nested block parameter changes as param leaves', () => {
    const script = (repeatValue: number, moveValue: number) => ({
      objects: [
        {
          name: '봇',
          scripts: [
            [
              { type: 'when_run_button_click' },
              {
                type: 'repeat_basic',
                params: { VALUE: repeatValue },
                statements: {
                  DO: [
                    {
                      type: 'move_direction',
                      params: { VALUE: moveValue },
                    },
                  ],
                },
              },
            ],
          ],
        },
      ],
    });

    const diff = diffProjects(script(4, 10), script(5, 20));

    expect(paths(diff.modified)).toEqual([
      'objects.봇.scripts[0][1].params.VALUE',
      'objects.봇.scripts[0][1].statements.DO[0].params.VALUE',
    ]);
    expect(diff.summary.modified).toBe(2);
    expect(diff.summary.scripts.modified).toBe(2);
    expect(diff.summary.blocks.modified).toBe(0);
    expect(diff.summary.objects.modified).toBe(0);
  });

  it('reports blocks added or removed inside a statement slot', () => {
    const script = (includeTurn: boolean) => {
      const doBlocks: Array<Plain> = [
        { type: 'move_direction', params: { VALUE: 10 } },
      ];
      if (includeTurn) {
        doBlocks.push({ type: 'rotate_direction', params: { VALUE: 90 } });
      }
      return {
        objects: [
          {
            name: '봇',
            scripts: [
              [
                { type: 'when_run_button_click' },
                {
                  type: 'repeat_basic',
                  params: { VALUE: 4 },
                  statements: { DO: doBlocks },
                },
              ],
            ],
          },
        ],
      };
    };

    const added = diffProjects(script(false), script(true));
    expect(added.added).toEqual([
      {
        path: 'objects.봇.scripts[0][1].statements.DO[1]',
        kind: 'added',
        after: { type: 'rotate_direction', params: { VALUE: 90 } },
      },
    ]);
    expect(added.summary.added).toBe(1);
    expect(added.summary.scripts.added).toBe(1);
    expect(added.summary.blocks.added).toBe(1);

    const removed = diffProjects(script(true), script(false));
    expect(removed.removed).toEqual([
      {
        path: 'objects.봇.scripts[0][1].statements.DO[1]',
        kind: 'removed',
        before: { type: 'rotate_direction', params: { VALUE: 90 } },
      },
    ]);
    expect(removed.summary.blocks.removed).toBe(1);
    expect(removed.summary.scripts.removed).toBe(1);
  });

  it('warns when block order changes without changing the type multiset', () => {
    const script = (moveFirst: boolean) => {
      const body: Array<Plain> = moveFirst
        ? [{ type: 'move_direction' }, { type: 'rotate_direction' }]
        : [{ type: 'rotate_direction' }, { type: 'move_direction' }];
      return {
        objects: [
          {
            name: '봇',
            scripts: [[{ type: 'when_run_button_click' }, ...body]],
          },
        ],
      };
    };

    const diff = diffProjects(script(true), script(false));

    expect(diff.warnings).toContain(
      'block order changed at objects.봇.scripts[0]',
    );
    expect(diff.summary.blocks.added).toBe(1);
    expect(diff.summary.blocks.removed).toBe(1);
    expect(diff.summary.scripts.added).toBe(1);
    expect(diff.summary.scripts.removed).toBe(1);
  });

  it('diffs variables, lists, messages, and functions', () => {
    const before = {
      objects: [objectWith({ scripts: [] })],
      variables: [{ name: '점수', initialValue: 0 }],
      lists: [{ name: '목록', initialValues: ['a'] }],
      messages: [{ name: '시작' }],
      functions: [
        {
          name: 'f',
          type: 'statement',
          body: [{ type: 'move_direction', params: { VALUE: 1 } }],
        },
      ],
    };
    const after = {
      objects: [objectWith({ scripts: [] })],
      variables: [{ name: '점수', initialValue: 5 }],
      lists: [{ name: '목록', initialValues: ['a', 'b'] }],
      messages: [{ name: '끝' }],
      functions: [
        {
          name: 'f',
          type: 'boolean',
          returnValue: true,
          body: [{ type: 'move_direction', params: { VALUE: 2 } }],
        },
      ],
    };

    const diff = diffProjects(before, after);

    expect(paths(diff.modified)).toEqual([
      'variables.점수.initialValue',
      'lists.목록.initialValues',
      'functions.f.type',
      'functions.f.returnValue',
      'functions.f.body[0].params.VALUE',
    ]);
    expect(paths(diff.removed)).toEqual(['messages.시작']);
    expect(paths(diff.added)).toEqual(['messages.끝']);
    expect(diff.summary.variables.modified).toBe(1);
    expect(diff.summary.lists.modified).toBe(1);
    expect(diff.summary.messages.removed).toBe(1);
    expect(diff.summary.messages.added).toBe(1);
    expect(diff.summary.functions.modified).toBe(3);
    expect(diff.summary.blocks.modified).toBe(0);
    expect(diff.warnings).toEqual([]);
  });

  it('diffs learning and speed as whole-value sections', () => {
    const before = {
      objects: [],
      learning: { type: 'number', labels: ['a'] },
      speed: 60,
    };
    const after = {
      objects: [],
      learning: { type: 'number', labels: ['b'] },
      speed: 30,
    };

    const modified = diffProjects(before, after);
    expect(paths(modified.modified)).toEqual(['learning', 'speed']);
    expect(modified.summary.learning.modified).toBe(1);
    expect(modified.summary.speed.modified).toBe(1);

    const added = diffProjects(
      { objects: [] },
      { objects: [], learning: { type: 'image', labels: [] }, speed: 24 },
    );
    expect(paths(added.added)).toEqual(['learning', 'speed']);
    expect(added.summary.learning.added).toBe(1);
    expect(added.summary.speed.added).toBe(1);

    const removed = diffProjects(
      { objects: [], learning: { type: 'image', labels: [] }, speed: 24 },
      { objects: [] },
    );
    expect(paths(removed.removed)).toEqual(['learning', 'speed']);
    expect(removed.summary.learning.removed).toBe(1);
    expect(removed.summary.speed.removed).toBe(1);
  });

  it('reports media additions/removals only through media', () => {
    const before = {
      scenes: [{ name: '장면', background: { path: 'assets/a.png' } }],
      objects: [
        {
          name: '봇',
          x: 0,
          scripts: [],
          pictures: [{ path: 'assets/a.png' }],
          sounds: [{ path: 'assets/s.mp3' }],
        },
      ],
    };
    const after = {
      scenes: [{ name: '장면', background: { path: 'assets/b.png' } }],
      objects: [
        {
          name: '봇',
          x: 5,
          scripts: [],
          pictures: [{ path: 'assets/b.png' }],
          sounds: [{ path: 'assets/s2.mp3' }],
        },
      ],
    };

    const diff = diffProjects(before, after);

    expect(diff.media.added).toEqual(['assets/b.png', 'assets/s2.mp3']);
    expect(diff.media.removed).toEqual(['assets/a.png', 'assets/s.mp3']);
    expect(diff.summary.media).toEqual({
      added: 2,
      removed: 2,
      modified: 0,
    });
    expect(paths(diff.added)).toEqual([]);
    expect(paths(diff.removed)).toEqual([]);
    expect(paths(diff.modified)).toEqual(['objects.봇.x']);
    expect(diff.summary.modified).toBe(1);
    expect(diff.summary.scenes.modified).toBe(0);
    expect(diff.summary.objects.modified).toBe(1);

    const allChanges = [...diff.added, ...diff.removed, ...diff.modified];
    expect(
      allChanges.every((change) => !change.path.startsWith('assets/')),
    ).toBe(true);
  });

  it('warns about likely renames while keeping remove+add changes', () => {
    const before = {
      objects: [objectWith({ name: '예전' })],
      variables: [{ name: 'oldVar', initialValue: 0 }],
    };
    const after = {
      objects: [objectWith({ name: '새것' })],
      variables: [{ name: 'newVar', initialValue: 0 }],
    };

    const diff = diffProjects(before, after);

    expect(diff.warnings).toEqual([
      'possible rename: objects "예전" -> "새것" (reported as remove+add)',
      'possible rename: variables "oldVar" -> "newVar" (reported as remove+add)',
    ]);
    expect(paths(diff.added)).toEqual(['objects.새것', 'variables.newVar']);
    expect(paths(diff.removed)).toEqual(['objects.예전', 'variables.oldVar']);

    const messages = diffProjects(
      { objects: [], messages: [{ name: 'a' }] },
      { objects: [], messages: [{ name: 'b' }] },
    );
    expect(messages.warnings).toEqual([]);
  });

  it('truncates each change list independently and reports omitted totals', () => {
    const before = {
      objects: [
        {
          name: 'gone',
          scripts: [[{ type: 'when_run_button_click' }]],
        },
      ],
    };
    const after = {
      objects: [
        { name: 'a', scripts: [] },
        { name: 'b', scripts: [] },
        { name: 'c', scripts: [] },
      ],
    };

    const diff = diffProjects(before, after, { maxChanges: 2 });

    expect(paths(diff.added)).toEqual(['objects.a', 'objects.b']);
    expect(paths(diff.removed)).toEqual(['objects.gone']);
    expect(diff.summary.added).toBe(3);
    expect(diff.summary.removed).toBe(1);
    expect(diff.omitted).toBe(1);
    expect(diff.truncated).toBe(true);

    const clamped = diffProjects({ objects: [] }, after, { maxChanges: 0 });
    expect(clamped.added).toHaveLength(1);
    expect(clamped.omitted).toBe(2);
    expect(clamped.truncated).toBe(true);
  });

  it('defaults to 200 changes per list', () => {
    const many = {
      objects: Array.from({ length: 201 }, (_, index) => ({
        name: `o${String(index).padStart(3, '0')}`,
        scripts: [],
      })),
    };

    const diff = diffProjects({ objects: [] }, many);

    expect(diff.added).toHaveLength(200);
    expect(diff.summary.added).toBe(201);
    expect(diff.omitted).toBe(1);
  });

  it('falls back to index-wise comparison for very large threads', () => {
    const bigThread = Array.from({ length: 501 }, () => ({
      type: 'move_direction',
    }));
    const before = { objects: [{ name: 'x', scripts: [bigThread] }] };
    const after = { objects: [{ name: 'x', scripts: [bigThread] }] };

    const diff = diffProjects(before, after);

    expect(diff.warnings).toContain(
      'block LCS limit exceeded at objects.x.scripts[0]; using index-wise comparison',
    );
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.modified).toEqual([]);
  });

  it('tolerates malformed inputs without throwing', () => {
    const empty = diffProjects(null, undefined);
    expect(empty.added).toEqual([]);
    expect(empty.removed).toEqual([]);
    expect(empty.modified).toEqual([]);
    expect(empty.summary.added).toBe(0);
    expect(empty.truncated).toBe(false);
    expect(empty.omitted).toBe(0);

    const malformed = diffProjects(
      {
        objects: 'not-an-array',
        scenes: { name: '장면' },
        variables: 5,
        lists: null,
        messages: {},
        functions: 'nope',
      },
      {
        objects: [
          null,
          42,
          { name: 123 },
          {
            name: 'ok',
            scripts: 'bad',
            pictures: 5,
            sounds: {},
          },
        ],
        variables: [null, { name: 'v', initialValue: 1 }],
      },
    );

    expect(paths(malformed.added)).toEqual(['objects.ok', 'variables.v']);
    expect(malformed.removed).toEqual([]);
    expect(malformed.modified).toEqual([]);
    expect(malformed.summary.added).toBe(2);

    const weirdBlocks = diffProjects(
      {
        objects: [
          {
            name: 'x',
            scripts: [[{ type: 'weird', params: 'no', statements: 'bad' }]],
          },
        ],
      },
      {
        objects: [
          {
            name: 'x',
            scripts: [[{ type: 'weird', params: 'no', statements: 'bad' }]],
          },
        ],
      },
    );
    expect(weirdBlocks.modified).toEqual([]);
  });

  it('does not mutate inputs and is deterministic', () => {
    const before = {
      objects: [
        {
          name: '봇',
          x: 0,
          scripts: [
            [
              { type: 'when_run_button_click' },
              { type: 'move_direction', params: { VALUE: 10 } },
            ],
          ],
        },
      ],
    };
    const after = {
      objects: [
        {
          name: '봇',
          x: 5,
          scripts: [
            [
              { type: 'when_run_button_click' },
              { type: 'move_direction', params: { VALUE: 20 } },
            ],
          ],
        },
      ],
    };
    const beforeSnapshot = structuredClone(before);
    const afterSnapshot = structuredClone(after);

    const first = diffProjects(before, after);
    const second = diffProjects(before, after);

    expect(before).toEqual(beforeSnapshot);
    expect(after).toEqual(afterSnapshot);
    expect(second).toEqual(first);
    expect(paths(first.modified)).toEqual([
      'objects.봇.x',
      'objects.봇.scripts[0][1].params.VALUE',
    ]);
  });

  it('treats object key order as insignificant', () => {
    const ordered = {
      objects: [{ name: '봇', sprite: 'entrybot', x: 1, scripts: [] }],
    };
    const reordered = {
      objects: [{ scripts: [], x: 1, sprite: 'entrybot', name: '봇' }],
    };

    const diff = diffProjects(ordered, reordered);

    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.modified).toEqual([]);
  });
});
