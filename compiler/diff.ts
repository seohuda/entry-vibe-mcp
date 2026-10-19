/**
 * Structural diff for two Entry IR values.
 *
 * The diff is intentionally pure: it never mutates its inputs, never reads
 * files, and tolerates malformed shapes by treating missing/non-array
 * sections as empty. Output ordering and warning text are deterministic so
 * the result can be compared in tests and surfaced through MCP tools.
 */

export type DiffKind = 'added' | 'removed' | 'modified';

export interface DiffChange {
  path: string;
  kind: DiffKind;
  before?: unknown;
  after?: unknown;
}

export interface DiffSectionSummary {
  added: number;
  removed: number;
  modified: number;
}

export interface ProjectDiff {
  summary: {
    added: number;
    removed: number;
    modified: number;
    scenes: DiffSectionSummary;
    objects: DiffSectionSummary;
    scripts: DiffSectionSummary;
    variables: DiffSectionSummary;
    lists: DiffSectionSummary;
    messages: DiffSectionSummary;
    functions: DiffSectionSummary;
    learning: DiffSectionSummary;
    speed: DiffSectionSummary;
    media: DiffSectionSummary;
    blocks: DiffSectionSummary;
  };
  added: DiffChange[];
  removed: DiffChange[];
  modified: DiffChange[];
  warnings: string[];
  media: { added: string[]; removed: string[] };
  truncated: boolean;
  omitted: number;
}

export interface DiffOptions {
  maxChanges?: number;
}

type JsonObject = Record<string, unknown>;
type SectionKey =
  | 'scenes'
  | 'objects'
  | 'scripts'
  | 'variables'
  | 'lists'
  | 'messages'
  | 'functions'
  | 'learning'
  | 'speed';

interface DiffState {
  added: DiffChange[];
  removed: DiffChange[];
  modified: DiffChange[];
  warnings: string[];
}

const DEFAULT_MAX_CHANGES = 200;
const MIN_MAX_CHANGES = 1;
const MAX_MAX_CHANGES = 2000;
/** LCS is skipped above this many index pairs (n * m). */
const LCS_PAIR_LIMIT = 250_000;

// Media references are reported only through `media` / `summary.media`.
const SCENE_FIELDS = [] as const;
const OBJECT_FIELDS = ['kind', 'sprite', 'text', 'x', 'y', 'scene'] as const;
const VARIABLE_FIELDS = ['initialValue'] as const;
const LIST_FIELDS = ['initialValues'] as const;
const FUNCTION_FIELDS = ['type', 'returnValue'] as const;

function asObject(value: unknown): JsonObject | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as JsonObject;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Deep equality: object key order is ignored, array order is significant,
 * and `undefined` values compare safely.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  if (typeof a !== 'object' || a === null) return false;
  if (typeof b !== 'object' || b === null) return false;

  const aObj = a as JsonObject;
  const bObj = b as JsonObject;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  if (aKeys.length !== bKeys.length) return false;

  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(bObj, key)) return false;
    if (!deepEqual(aObj[key], bObj[key])) return false;
  }
  return true;
}

function unionKeys(a: JsonObject, b: JsonObject): string[] {
  const keys = new Set<string>();
  for (const key of Object.keys(a)) keys.add(key);
  for (const key of Object.keys(b)) keys.add(key);
  return [...keys].sort();
}

function namedEntries(
  root: JsonObject | undefined,
  section: string,
): Map<string, JsonObject> {
  const result = new Map<string, JsonObject>();
  if (!root) return result;
  const raw = root[section];
  if (!Array.isArray(raw)) return result;

  for (const item of raw) {
    const obj = asObject(item);
    if (!obj) continue;
    const name = obj.name;
    if (typeof name !== 'string' || result.has(name)) continue;
    result.set(name, obj);
  }
  return result;
}

function defWithoutName(entity: JsonObject): JsonObject {
  const result: JsonObject = {};
  for (const key of Object.keys(entity)) {
    if (key !== 'name') result[key] = entity[key];
  }
  return result;
}

function detectRenames(
  section: string,
  before: Map<string, JsonObject>,
  after: Map<string, JsonObject>,
  addedNames: string[],
  removedNames: string[],
  state: DiffState,
): void {
  const consumed = new Set<string>();

  for (const oldName of removedNames) {
    const oldDef = defWithoutName(before.get(oldName) ?? {});
    for (const newName of addedNames) {
      if (consumed.has(newName)) continue;
      const newDef = defWithoutName(after.get(newName) ?? {});
      if (!deepEqual(oldDef, newDef)) continue;
      consumed.add(newName);
      state.warnings.push(
        `possible rename: ${section} "${oldName}" -> "${newName}" (reported as remove+add)`,
      );
      break;
    }
  }
}

type CommonComparison = (
  name: string,
  before: JsonObject,
  after: JsonObject,
  state: DiffState,
) => void;

function diffNamedSection(
  section: string,
  beforeRoot: JsonObject | undefined,
  afterRoot: JsonObject | undefined,
  state: DiffState,
  compareCommon?: CommonComparison,
  detectRename = true,
): void {
  const before = namedEntries(beforeRoot, section);
  const after = namedEntries(afterRoot, section);
  const beforeNames = [...before.keys()].sort();
  const afterNames = [...after.keys()].sort();
  const addedNames: string[] = [];
  const removedNames: string[] = [];

  for (const name of beforeNames) {
    if (after.has(name)) continue;
    removedNames.push(name);
    state.removed.push({
      path: `${section}.${name}`,
      kind: 'removed',
      before: before.get(name),
    });
  }

  for (const name of afterNames) {
    if (before.has(name)) continue;
    addedNames.push(name);
    state.added.push({
      path: `${section}.${name}`,
      kind: 'added',
      after: after.get(name),
    });
  }

  if (compareCommon) {
    for (const name of beforeNames) {
      if (!after.has(name)) continue;
      const beforeEntity = before.get(name);
      const afterEntity = after.get(name);
      if (beforeEntity && afterEntity) {
        compareCommon(name, beforeEntity, afterEntity, state);
      }
    }
  }

  if (detectRename) {
    detectRenames(section, before, after, addedNames, removedNames, state);
  }
}

function diffFields(
  pathPrefix: string,
  fields: readonly string[],
  before: JsonObject,
  after: JsonObject,
  state: DiffState,
): void {
  for (const field of fields) {
    const beforeValue = before[field];
    const afterValue = after[field];
    if (deepEqual(beforeValue, afterValue)) continue;
    state.modified.push({
      path: `${pathPrefix}.${field}`,
      kind: 'modified',
      before: beforeValue,
      after: afterValue,
    });
  }
}

function diffMatchedMediaFields(
  entryPath: string,
  before: JsonObject,
  after: JsonObject,
  state: DiffState,
): void {
  for (const field of unionKeys(before, after)) {
    if (field === 'path') continue;
    const beforeValue = before[field];
    const afterValue = after[field];
    if (deepEqual(beforeValue, afterValue)) continue;
    state.modified.push({
      path: `${entryPath}.${field}`,
      kind: 'modified',
      before: beforeValue,
      after: afterValue,
    });
  }
}

function diffMediaEntries(
  pathPrefix: string,
  field: 'pictures' | 'sounds',
  before: JsonObject,
  after: JsonObject,
  state: DiffState,
): void {
  const beforeEntries = new Map<string, JsonObject>();
  for (const item of asArray(before[field])) {
    const obj = asObject(item);
    if (!obj || typeof obj.path !== 'string') continue;
    if (!beforeEntries.has(obj.path)) beforeEntries.set(obj.path, obj);
  }

  const afterEntries = asArray(after[field]);
  for (let index = 0; index < afterEntries.length; index += 1) {
    const obj = asObject(afterEntries[index]);
    if (!obj || typeof obj.path !== 'string') continue;
    const beforeEntry = beforeEntries.get(obj.path);
    if (!beforeEntry) continue;
    diffMatchedMediaFields(
      `${pathPrefix}.${field}[${index}]`,
      beforeEntry,
      obj,
      state,
    );
  }
}

function diffBackground(
  pathPrefix: string,
  before: JsonObject,
  after: JsonObject,
  state: DiffState,
): void {
  const beforeBackground = asObject(before.background);
  const afterBackground = asObject(after.background);
  if (!beforeBackground || !afterBackground) return;
  if (typeof beforeBackground.path !== 'string') return;
  if (beforeBackground.path !== afterBackground.path) return;
  diffMatchedMediaFields(
    `${pathPrefix}.background`,
    beforeBackground,
    afterBackground,
    state,
  );
}

function blockTypeOf(block: unknown): string {
  const obj = asObject(block);
  if (!obj) return '\u0000missing';
  return typeof obj.type === 'string' ? obj.type : '\u0000missing';
}

function sameTypeMultiset(before: unknown[], after: unknown[]): boolean {
  if (before.length !== after.length) return false;
  const counts = new Map<string, number>();
  for (const block of before) {
    const type = blockTypeOf(block);
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  for (const block of after) {
    const type = blockTypeOf(block);
    const count = counts.get(type);
    if (count === undefined || count === 0) return false;
    counts.set(type, count - 1);
  }
  return true;
}

function lcsMatches(
  before: unknown[],
  after: unknown[],
): Array<readonly [number, number]> {
  const n = before.length;
  const m = after.length;
  const beforeTypes = before.map(blockTypeOf);
  const afterTypes = after.map(blockTypeOf);
  const width = m + 1;
  const dp = new Uint32Array((n + 1) * width);

  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      const index = i * width + j;
      if (beforeTypes[i] === afterTypes[j]) {
        dp[index] = dp[(i + 1) * width + (j + 1)] + 1;
      } else {
        const down = dp[(i + 1) * width + j];
        const right = dp[i * width + (j + 1)];
        dp[index] = down >= right ? down : right;
      }
    }
  }

  const matches: Array<readonly [number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (beforeTypes[i] === afterTypes[j]) {
      matches.push([i, j]);
      i += 1;
      j += 1;
    } else if (dp[(i + 1) * width + j] >= dp[i * width + (j + 1)]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return matches;
}

function diffParams(
  before: JsonObject | undefined,
  after: JsonObject | undefined,
  blockPath: string,
  state: DiffState,
): void {
  const beforeParams = asObject(before?.params) ?? {};
  const afterParams = asObject(after?.params) ?? {};

  for (const key of unionKeys(beforeParams, afterParams)) {
    const beforeValue = beforeParams[key];
    const afterValue = afterParams[key];
    if (deepEqual(beforeValue, afterValue)) continue;
    state.modified.push({
      path: `${blockPath}.params.${key}`,
      kind: 'modified',
      before: beforeValue,
      after: afterValue,
    });
  }
}

function diffStatements(
  before: JsonObject | undefined,
  after: JsonObject | undefined,
  blockPath: string,
  state: DiffState,
): void {
  const beforeStatements = asObject(before?.statements) ?? {};
  const afterStatements = asObject(after?.statements) ?? {};

  for (const slot of unionKeys(beforeStatements, afterStatements)) {
    diffThread(
      asArray(beforeStatements[slot]),
      asArray(afterStatements[slot]),
      `${blockPath}.statements.${slot}`,
      state,
    );
  }
}

function diffBlock(
  before: unknown,
  after: unknown,
  blockPath: string,
  state: DiffState,
): void {
  const beforeObj = asObject(before);
  const afterObj = asObject(after);
  diffParams(beforeObj, afterObj, blockPath, state);
  diffStatements(beforeObj, afterObj, blockPath, state);
}

function diffThread(
  before: unknown[],
  after: unknown[],
  basePath: string,
  state: DiffState,
): void {
  const n = before.length;
  const m = after.length;
  const useLcs = n * m <= LCS_PAIR_LIMIT;

  let matches: Array<readonly [number, number]>;
  if (useLcs) {
    matches = lcsMatches(before, after);
  } else {
    state.warnings.push(
      `block LCS limit exceeded at ${basePath}; using index-wise comparison`,
    );
    matches = [];
    const shorter = Math.min(n, m);
    for (let i = 0; i < shorter; i += 1) {
      if (blockTypeOf(before[i]) === blockTypeOf(after[i])) {
        matches.push([i, i]);
      }
    }
  }

  const beforeMatched = new Uint8Array(n);
  const afterMatched = new Uint8Array(m);
  for (const [beforeIndex, afterIndex] of matches) {
    beforeMatched[beforeIndex] = 1;
    afterMatched[afterIndex] = 1;
  }

  for (let i = 0; i < n; i += 1) {
    if (beforeMatched[i]) continue;
    state.removed.push({
      path: `${basePath}[${i}]`,
      kind: 'removed',
      before: before[i],
    });
  }

  for (let j = 0; j < m; j += 1) {
    if (afterMatched[j]) continue;
    state.added.push({
      path: `${basePath}[${j}]`,
      kind: 'added',
      after: after[j],
    });
  }

  for (const [beforeIndex, afterIndex] of matches) {
    diffBlock(
      before[beforeIndex],
      after[afterIndex],
      `${basePath}[${afterIndex}]`,
      state,
    );
  }

  const removedCount = n - matches.length;
  const addedCount = m - matches.length;
  if (
    useLcs &&
    removedCount > 0 &&
    addedCount > 0 &&
    sameTypeMultiset(before, after)
  ) {
    state.warnings.push(`block order changed at ${basePath}`);
  }
}

function compareObject(
  name: string,
  before: JsonObject,
  after: JsonObject,
  state: DiffState,
): void {
  const pathPrefix = `objects.${name}`;
  diffFields(pathPrefix, OBJECT_FIELDS, before, after, state);
  diffMediaEntries(pathPrefix, 'pictures', before, after, state);
  diffMediaEntries(pathPrefix, 'sounds', before, after, state);

  const beforeThreads = asArray(before.scripts);
  const afterThreads = asArray(after.scripts);
  const threadCount = Math.max(beforeThreads.length, afterThreads.length);
  for (let i = 0; i < threadCount; i += 1) {
    diffThread(
      asArray(beforeThreads[i]),
      asArray(afterThreads[i]),
      `${pathPrefix}.scripts[${i}]`,
      state,
    );
  }
}

function compareFunction(
  name: string,
  before: JsonObject,
  after: JsonObject,
  state: DiffState,
): void {
  const pathPrefix = `functions.${name}`;
  diffFields(pathPrefix, FUNCTION_FIELDS, before, after, state);
  diffThread(
    asArray(before.body),
    asArray(after.body),
    `${pathPrefix}.body`,
    state,
  );
}

function diffScalarSection(
  section: 'learning' | 'speed',
  beforeRoot: JsonObject | undefined,
  afterRoot: JsonObject | undefined,
  state: DiffState,
): void {
  const beforeValue = beforeRoot ? beforeRoot[section] : undefined;
  const afterValue = afterRoot ? afterRoot[section] : undefined;
  const beforeExists = beforeValue !== undefined;
  const afterExists = afterValue !== undefined;

  if (!beforeExists && !afterExists) return;

  if (beforeExists && !afterExists) {
    state.removed.push({
      path: section,
      kind: 'removed',
      before: beforeValue,
    });
    return;
  }

  if (!beforeExists && afterExists) {
    state.added.push({
      path: section,
      kind: 'added',
      after: afterValue,
    });
    return;
  }

  if (!deepEqual(beforeValue, afterValue)) {
    state.modified.push({
      path: section,
      kind: 'modified',
      before: beforeValue,
      after: afterValue,
    });
  }
}

function collectMedia(root: JsonObject | undefined): Set<string> {
  const paths = new Set<string>();
  if (!root) return paths;

  for (const scene of asArray(root.scenes)) {
    const sceneObj = asObject(scene);
    const background = asObject(sceneObj?.background);
    if (background && typeof background.path === 'string') {
      paths.add(background.path);
    }
  }

  for (const object of asArray(root.objects)) {
    const objectObj = asObject(object);
    if (!objectObj) continue;

    for (const picture of asArray(objectObj.pictures)) {
      const pictureObj = asObject(picture);
      if (pictureObj && typeof pictureObj.path === 'string') {
        paths.add(pictureObj.path);
      }
    }

    for (const sound of asArray(objectObj.sounds)) {
      const soundObj = asObject(sound);
      if (soundObj && typeof soundObj.path === 'string') {
        paths.add(soundObj.path);
      }
    }
  }

  return paths;
}

function emptySection(): DiffSectionSummary {
  return { added: 0, removed: 0, modified: 0 };
}

function sectionForPath(path: string): SectionKey | undefined {
  if (path === 'learning' || path.startsWith('learning.')) return 'learning';
  if (path === 'speed' || path.startsWith('speed.')) return 'speed';
  if (path === 'scenes' || path.startsWith('scenes.')) return 'scenes';
  if (path.startsWith('objects.')) {
    return /\.scripts(\[|\.|$)/.test(path) ? 'scripts' : 'objects';
  }
  if (path.startsWith('variables.')) return 'variables';
  if (path.startsWith('lists.')) return 'lists';
  if (path.startsWith('messages.')) return 'messages';
  if (path.startsWith('functions.')) return 'functions';
  return undefined;
}

function isBlockEvent(path: string): boolean {
  return /\[\d+\]$/.test(path);
}

function countChange(
  summary: ProjectDiff['summary'],
  change: DiffChange,
  kind: DiffKind,
): void {
  const section = sectionForPath(change.path);
  if (section) summary[section][kind] += 1;
  if (isBlockEvent(change.path)) summary.blocks[kind] += 1;
}

function buildSummary(
  added: DiffChange[],
  removed: DiffChange[],
  modified: DiffChange[],
  mediaAdded: string[],
  mediaRemoved: string[],
): ProjectDiff['summary'] {
  const summary: ProjectDiff['summary'] = {
    added: added.length,
    removed: removed.length,
    modified: modified.length,
    scenes: emptySection(),
    objects: emptySection(),
    scripts: emptySection(),
    variables: emptySection(),
    lists: emptySection(),
    messages: emptySection(),
    functions: emptySection(),
    learning: emptySection(),
    speed: emptySection(),
    media: emptySection(),
    blocks: emptySection(),
  };

  summary.media.added = mediaAdded.length;
  summary.media.removed = mediaRemoved.length;
  summary.media.modified = 0;

  for (const change of added) countChange(summary, change, 'added');
  for (const change of removed) countChange(summary, change, 'removed');
  for (const change of modified) countChange(summary, change, 'modified');
  return summary;
}

function clampMaxChanges(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_MAX_CHANGES;
  }
  const floored = Math.floor(value);
  if (floored < MIN_MAX_CHANGES) return MIN_MAX_CHANGES;
  if (floored > MAX_MAX_CHANGES) return MAX_MAX_CHANGES;
  return floored;
}

function dedupeWarnings(warnings: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const warning of warnings) {
    if (seen.has(warning)) continue;
    seen.add(warning);
    result.push(warning);
  }
  return result;
}

/**
 * Compute a deterministic structural diff between two Entry IR values.
 *
 * `maxChanges` applies independently to each of `added`, `removed`, and
 * `modified`. Summary counts always describe the full, pre-truncation diff.
 */
export function diffProjects(
  before: unknown,
  after: unknown,
  options: DiffOptions = {},
): ProjectDiff {
  const state: DiffState = {
    added: [],
    removed: [],
    modified: [],
    warnings: [],
  };
  const beforeRoot = asObject(before);
  const afterRoot = asObject(after);

  diffNamedSection(
    'scenes',
    beforeRoot,
    afterRoot,
    state,
    (name, beforeEntity, afterEntity, diffState) => {
      diffFields(
        `scenes.${name}`,
        SCENE_FIELDS,
        beforeEntity,
        afterEntity,
        diffState,
      );
      diffBackground(
        `scenes.${name}`,
        beforeEntity,
        afterEntity,
        diffState,
      );
    },
  );

  diffNamedSection('objects', beforeRoot, afterRoot, state, compareObject);

  diffNamedSection(
    'variables',
    beforeRoot,
    afterRoot,
    state,
    (name, beforeEntity, afterEntity, diffState) => {
      diffFields(
        `variables.${name}`,
        VARIABLE_FIELDS,
        beforeEntity,
        afterEntity,
        diffState,
      );
    },
  );

  diffNamedSection(
    'lists',
    beforeRoot,
    afterRoot,
    state,
    (name, beforeEntity, afterEntity, diffState) => {
      diffFields(
        `lists.${name}`,
        LIST_FIELDS,
        beforeEntity,
        afterEntity,
        diffState,
      );
    },
  );

  // Messages have identity only, and renames are intentionally not reported.
  diffNamedSection('messages', beforeRoot, afterRoot, state, undefined, false);

  diffNamedSection('functions', beforeRoot, afterRoot, state, compareFunction);

  diffScalarSection('learning', beforeRoot, afterRoot, state);
  diffScalarSection('speed', beforeRoot, afterRoot, state);

  const beforeMedia = collectMedia(beforeRoot);
  const afterMedia = collectMedia(afterRoot);
  const mediaAdded = [...afterMedia]
    .filter((path) => !beforeMedia.has(path))
    .sort();
  const mediaRemoved = [...beforeMedia]
    .filter((path) => !afterMedia.has(path))
    .sort();

  const summary = buildSummary(
    state.added,
    state.removed,
    state.modified,
    mediaAdded,
    mediaRemoved,
  );

  const maxChanges = clampMaxChanges(options?.maxChanges);
  const added = state.added.slice(0, maxChanges);
  const removed = state.removed.slice(0, maxChanges);
  const modified = state.modified.slice(0, maxChanges);
  const omitted =
    state.added.length -
    added.length +
    (state.removed.length - removed.length) +
    (state.modified.length - modified.length);

  return {
    summary,
    added,
    removed,
    modified,
    warnings: dedupeWarnings(state.warnings),
    media: { added: mediaAdded, removed: mediaRemoved },
    truncated: omitted > 0,
    omitted,
  };
}
