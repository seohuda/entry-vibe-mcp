/**
 * Deterministic, stateless IR repairs for the repair_project MCP tool.
 *
 * Only mistakes that can be fixed without guessing intent are repaired.
 * Unknown blocks/params, missing custom media, and unresolved references
 * without `allowSemanticAdditions` stay in `remainingErrors`.
 */
import type { EntryIR } from '../src/types/ir.ts';
import {
  LIST_PARAM_KEY,
  MESSAGE_BLOCK_TYPES,
  MESSAGE_PARAM_KEY,
  VARIABLE_PARAM_KEY,
  validateProject,
  type ValidationResult,
} from './validate.ts';

export type RepairAction = 'add' | 'remove' | 'update';

export interface RepairChange {
  path: string;
  action: RepairAction;
  before?: unknown;
  after?: unknown;
  reason: string;
}

export interface RepairPolicy {
  allowSemanticAdditions?: boolean;
}

export interface RepairOptions {
  dryRun?: boolean;
  policy?: RepairPolicy;
}

export interface RepairResult {
  ok: boolean;
  dryRun: boolean;
  repairedIR: unknown;
  changes: RepairChange[];
  remainingErrors: string[];
  validation: ValidationResult;
  warnings: string[];
}

type UnknownRecord = Record<string, unknown>;

const OBJECTS_ERROR = 'ir.objects must be a non-empty array';
const OBJECTS_HINT =
  'Provide at least one object with name, sprite/kind, and scripts.';
const SHAPE_HINT =
  'Ensure objects, scripts, declarations, and statement slots use the IR array/object shapes.';

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Non-empty, no leading/trailing whitespace. */
function isValidName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value === value.trim();
}

function isPositiveFiniteNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function snapshot(value: unknown): unknown {
  return structuredClone(value);
}

/** Key-order-independent structural equality for JSON-like IR values. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  if (isRecord(a) && isRecord(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) => Object.hasOwn(b, key) && deepEqual(a[key], b[key]));
  }
  return false;
}

function structuralFailure(input: unknown, dryRun: boolean): RepairResult {
  return {
    ok: false,
    dryRun,
    repairedIR: input,
    changes: [],
    remainingErrors: [OBJECTS_ERROR],
    validation: { valid: false, errors: [OBJECTS_ERROR], hints: [OBJECTS_HINT] },
    warnings: [],
  };
}

function unsalvageableFailure(
  repairedIR: unknown,
  dryRun: boolean,
  message: string,
  changes: RepairChange[],
  warnings: string[],
): RepairResult {
  return {
    ok: false,
    dryRun,
    repairedIR,
    changes,
    remainingErrors: [message],
    validation: { valid: false, errors: [message], hints: [SHAPE_HINT] },
    warnings,
  };
}

/** Reject container shapes `validateProject` cannot traverse without throwing. */
function shapeProblem(ir: UnknownRecord): string | null {
  for (const key of ['scenes', 'variables', 'lists', 'messages', 'functions'] as const) {
    const value = ir[key];
    if (value !== undefined && !Array.isArray(value)) {
      return `ir.${key} must be an array when provided`;
    }
  }
  const objects = ir.objects as unknown[];
  for (let i = 0; i < objects.length; i += 1) {
    if (!isRecord(objects[i])) return `ir.objects[${i}] must be an object`;
  }
  const functions = ir.functions;
  if (Array.isArray(functions)) {
    for (let i = 0; i < functions.length; i += 1) {
      if (!isRecord(functions[i])) return `ir.functions[${i}] must be an object`;
    }
  }
  return null;
}

function finish(
  repairedIR: unknown,
  dryRun: boolean,
  changes: RepairChange[],
  warnings: string[],
): RepairResult {
  let validation: ValidationResult;
  try {
    validation = validateProject(repairedIR as EntryIR);
  } catch (err) {
    const message = `validation could not run on the repaired IR: ${
      err instanceof Error ? err.message : String(err)
    }`;
    validation = { valid: false, errors: [message], hints: [SHAPE_HINT] };
  }
  return {
    ok: validation.valid,
    dryRun,
    repairedIR,
    changes,
    remainingErrors: validation.errors,
    validation,
    warnings,
  };
}

const DECLARATION_LABELS: Record<string, string> = {
  scenes: 'scene',
  variables: 'variable',
  lists: 'list',
  messages: 'message',
  functions: 'function',
  objects: 'object',
};

function declaredNameSet(ir: UnknownRecord, key: string): Set<string> {
  const names = new Set<string>();
  const entries = ir[key];
  if (!Array.isArray(entries)) return names;
  for (const entry of entries) {
    if (isRecord(entry) && isValidName(entry.name)) names.add(entry.name);
  }
  return names;
}

function dedupeDeclarations(
  ir: UnknownRecord,
  key: string,
  changes: RepairChange[],
): void {
  const entries = ir[key];
  if (!Array.isArray(entries)) return;
  const label = DECLARATION_LABELS[key] ?? key;
  const firstByName = new Map<string, unknown>();
  const kept: unknown[] = [];

  entries.forEach((entry, index) => {
    const name = isRecord(entry) ? entry.name : undefined;
    if (!isValidName(name)) {
      kept.push(entry);
      return;
    }
    if (!firstByName.has(name)) {
      firstByName.set(name, entry);
      kept.push(entry);
      return;
    }
    if (!deepEqual(firstByName.get(name), entry)) {
      kept.push(entry);
      return;
    }
    changes.push({
      path: `${key}[${index}]`,
      action: 'remove',
      before: snapshot(entry),
      reason: `duplicate ${label} name ${JSON.stringify(name)}`,
    });
  });

  ir[key] = kept;
}

function repairFunctions(ir: UnknownRecord, changes: RepairChange[]): void {
  const functions = ir.functions;
  if (!Array.isArray(functions)) return;
  functions.forEach((fn, index) => {
    if (!isRecord(fn)) return;
    if (!Array.isArray(fn.body)) {
      const hasBody = Object.hasOwn(fn, 'body');
      const before = hasBody ? snapshot(fn.body) : undefined;
      fn.body = [];
      changes.push({
        path: `functions[${index}].body`,
        action: hasBody ? 'update' : 'add',
        ...(hasBody ? { before } : {}),
        after: [],
        reason: 'function body must be an array of blocks',
      });
    }
    if (
      Object.hasOwn(fn, 'type') &&
      fn.type !== 'statement' &&
      fn.type !== 'string' &&
      fn.type !== 'boolean'
    ) {
      const before = snapshot(fn.type);
      fn.type = 'statement';
      changes.push({
        path: `functions[${index}].type`,
        action: 'update',
        before,
        after: 'statement',
        reason: 'function type must be statement|string|boolean',
      });
    }
  });
}

function repairObject(
  obj: UnknownRecord,
  index: number,
  changes: RepairChange[],
): void {
  const prefix = `objects[${index}]`;

  if (Array.isArray(obj.scripts)) {
    const scripts = obj.scripts;
    const kept: unknown[] = [];
    scripts.forEach((thread, threadIndex) => {
      if (Array.isArray(thread) && thread.length === 0) {
        changes.push({
          path: `${prefix}.scripts[${threadIndex}]`,
          action: 'remove',
          before: snapshot(thread),
          reason: 'empty script thread',
        });
        return;
      }
      kept.push(thread);
    });
    if (kept.length !== scripts.length) obj.scripts = kept;
  }

  const kind = obj.kind ?? 'sprite';
  if (kind === 'text') {
    if (Object.hasOwn(obj, 'sprite')) {
      const before = snapshot(obj.sprite);
      delete obj.sprite;
      changes.push({
        path: `${prefix}.sprite`,
        action: 'remove',
        before,
        reason: 'text objects do not use sprite',
      });
    }
    if (Object.hasOwn(obj, 'pictures')) {
      const before = snapshot(obj.pictures);
      delete obj.pictures;
      changes.push({
        path: `${prefix}.pictures`,
        action: 'remove',
        before,
        reason: 'text objects do not use pictures',
      });
    }
    if (!Array.isArray(obj.scripts)) {
      const hasScripts = Object.hasOwn(obj, 'scripts');
      const before = hasScripts ? snapshot(obj.scripts) : undefined;
      obj.scripts = [];
      changes.push({
        path: `${prefix}.scripts`,
        action: hasScripts ? 'update' : 'add',
        ...(hasScripts ? { before } : {}),
        after: [],
        reason: 'text objects require a scripts array',
      });
    }
  } else if (kind === 'sprite') {
    const sprite = obj.sprite ?? 'entrybot';
    if (sprite !== 'custom' && Array.isArray(obj.pictures) && obj.pictures.length === 0) {
      const before = snapshot(obj.pictures);
      delete obj.pictures;
      changes.push({
        path: `${prefix}.pictures`,
        action: 'remove',
        before,
        reason: 'pictures must be omitted for built-in sprites',
      });
    }
  }

  if (Array.isArray(obj.sounds)) {
    obj.sounds.forEach((sound, soundIndex) => {
      if (!isRecord(sound)) return;
      if (Object.hasOwn(sound, 'duration') && !isPositiveFiniteNumber(sound.duration)) {
        const before = snapshot(sound.duration);
        delete sound.duration;
        changes.push({
          path: `${prefix}.sounds[${soundIndex}].duration`,
          action: 'remove',
          before,
          reason: 'sound duration must be a positive finite number',
        });
      }
    });
  }
}

function addMissingScenes(
  ir: UnknownRecord,
  changes: RepairChange[],
  warnings: string[],
): void {
  const declared = declaredNameSet(ir, 'scenes');
  const referenced: string[] = [];
  const seen = new Set<string>();
  const warned = new Set<string>();

  for (const entry of ir.objects as unknown[]) {
    if (!isRecord(entry)) continue;
    const scene = entry.scene;
    if (typeof scene !== 'string') continue;
    if (!isValidName(scene)) {
      if (!warned.has(scene)) {
        warned.add(scene);
        warnings.push(
          `Skipped scene reference with invalid name ${JSON.stringify(scene)} — use a non-empty name without leading/trailing whitespace.`,
        );
      }
      continue;
    }
    if (declared.has(scene) || seen.has(scene)) continue;
    seen.add(scene);
    referenced.push(scene);
  }

  if (referenced.length === 0) return;

  let scenes: unknown[];
  if (Array.isArray(ir.scenes) && ir.scenes.length > 0) {
    scenes = ir.scenes;
  } else {
    scenes = [];
    ir.scenes = scenes;
    if (referenced[0] !== '장면 1') {
      const defaultScene = { name: '장면 1' };
      scenes.push(defaultScene);
      declared.add(defaultScene.name);
      changes.push({
        path: 'scenes[0]',
        action: 'add',
        after: snapshot(defaultScene),
        reason: 'materialize implicit default scene',
      });
    }
  }

  for (const name of referenced) {
    if (declared.has(name)) continue;
    const scene = { name };
    const index = scenes.length;
    scenes.push(scene);
    declared.add(name);
    changes.push({
      path: `scenes[${index}]`,
      action: 'add',
      after: snapshot(scene),
      reason: 'object references undeclared scene',
    });
  }
}

interface ReferenceScan {
  variables: string[];
  lists: string[];
  messages: string[];
}

function collectReferences(ir: UnknownRecord): ReferenceScan {
  const found: ReferenceScan = { variables: [], lists: [], messages: [] };
  const seen = {
    variables: new Set<string>(),
    lists: new Set<string>(),
    messages: new Set<string>(),
  };
  const visited = new WeakSet<object>();

  const addRef = (key: keyof ReferenceScan, value: string): void => {
    if (seen[key].has(value)) return;
    seen[key].add(value);
    found[key].push(value);
  };

  const visitBlock = (block: unknown): void => {
    if (!isRecord(block) || visited.has(block)) return;
    visited.add(block);
    const blockType = typeof block.type === 'string' ? block.type : undefined;

    if (isRecord(block.params)) {
      for (const [key, value] of Object.entries(block.params)) {
        if (typeof value !== 'string') continue;
        if (key === VARIABLE_PARAM_KEY) addRef('variables', value);
        if (key === LIST_PARAM_KEY) addRef('lists', value);
        if (
          blockType !== undefined &&
          MESSAGE_BLOCK_TYPES.has(blockType) &&
          key === MESSAGE_PARAM_KEY
        ) {
          addRef('messages', value);
        }
      }
      for (const value of Object.values(block.params)) {
        if (isRecord(value)) visitBlock(value);
      }
    }

    if (isRecord(block.statements)) {
      for (const thread of Object.values(block.statements)) {
        if (!Array.isArray(thread)) continue;
        for (const nested of thread) visitBlock(nested);
      }
    }
  };

  for (const entry of ir.objects as unknown[]) {
    if (!isRecord(entry) || !Array.isArray(entry.scripts)) continue;
    for (const thread of entry.scripts) {
      if (!Array.isArray(thread)) continue;
      for (const block of thread) visitBlock(block);
    }
  }

  if (Array.isArray(ir.functions)) {
    for (const fn of ir.functions) {
      if (!isRecord(fn)) continue;
      if (Array.isArray(fn.body)) {
        for (const block of fn.body) visitBlock(block);
      }
      visitBlock(fn.returnValue);
    }
  }

  return found;
}

interface DeclarationSpec {
  key: 'variables' | 'lists' | 'messages';
  category: string;
  make: (name: string) => unknown;
  reason: string;
}

function addMissingDeclarations(
  ir: UnknownRecord,
  refs: string[],
  spec: DeclarationSpec,
  changes: RepairChange[],
  warnings: string[],
): void {
  if (refs.length === 0) return;
  const declared = declaredNameSet(ir, spec.key);
  let target: unknown[] | undefined = Array.isArray(ir[spec.key])
    ? (ir[spec.key] as unknown[])
    : undefined;

  for (const name of refs) {
    if (declared.has(name)) continue;
    if (!isValidName(name)) {
      warnings.push(
        `Skipped undeclared ${spec.category} reference with invalid name ${JSON.stringify(name)} — use a non-empty name without leading/trailing whitespace.`,
      );
      continue;
    }
    if (!target) {
      target = [];
      ir[spec.key] = target;
    }
    const declaration = spec.make(name);
    target.push(declaration);
    declared.add(name);
    changes.push({
      path: `${spec.key}[${target.length - 1}]`,
      action: 'add',
      after: snapshot(declaration),
      reason: spec.reason,
    });
  }
}

function applySemanticAdditions(
  ir: UnknownRecord,
  changes: RepairChange[],
  warnings: string[],
): void {
  addMissingScenes(ir, changes, warnings);
  const refs = collectReferences(ir);
  addMissingDeclarations(
    ir,
    refs.variables,
    {
      key: 'variables',
      category: 'variable',
      make: (name) => ({ name, initialValue: 0 }),
      reason: 'block references undeclared variable',
    },
    changes,
    warnings,
  );
  addMissingDeclarations(
    ir,
    refs.lists,
    {
      key: 'lists',
      category: 'list',
      make: (name) => ({ name, initialValues: [] }),
      reason: 'block references undeclared list',
    },
    changes,
    warnings,
  );
  addMissingDeclarations(
    ir,
    refs.messages,
    {
      key: 'messages',
      category: 'message',
      make: (name) => ({ name }),
      reason: 'message block references undeclared message',
    },
    changes,
    warnings,
  );
}

export function repairProject(input: unknown, options: RepairOptions = {}): RepairResult {
  const dryRun = options.dryRun ?? true;
  if (
    !isRecord(input) ||
    !Array.isArray(input.objects) ||
    input.objects.length === 0
  ) {
    return structuralFailure(input, dryRun);
  }

  let repairIR: UnknownRecord;
  try {
    repairIR = structuredClone(input);
  } catch (err) {
    return unsalvageableFailure(
      input,
      dryRun,
      `ir could not be cloned: ${err instanceof Error ? err.message : String(err)}`,
      [],
      [],
    );
  }

  const changes: RepairChange[] = [];
  const warnings: string[] = [];

  const problem = shapeProblem(repairIR);
  if (problem !== null) {
    return unsalvageableFailure(repairIR, dryRun, problem, changes, warnings);
  }

  // B. speed
  if (Object.hasOwn(repairIR, 'speed') && !isPositiveFiniteNumber(repairIR.speed)) {
    const before = snapshot(repairIR.speed);
    delete repairIR.speed;
    changes.push({
      path: 'speed',
      action: 'remove',
      before,
      reason: 'speed must be a positive finite number',
    });
  }

  // C. functions
  repairFunctions(repairIR, changes);

  // D. declarations (scenes, variables, lists, messages, functions, objects)
  dedupeDeclarations(repairIR, 'scenes', changes);
  dedupeDeclarations(repairIR, 'variables', changes);
  dedupeDeclarations(repairIR, 'lists', changes);
  dedupeDeclarations(repairIR, 'messages', changes);
  dedupeDeclarations(repairIR, 'functions', changes);
  dedupeDeclarations(repairIR, 'objects', changes);

  // E. objects
  const objects = repairIR.objects as unknown[];
  objects.forEach((obj, index) => {
    if (isRecord(obj)) repairObject(obj, index, changes);
  });

  // F. semantic additions (opt-in)
  if (options.policy?.allowSemanticAdditions === true) {
    applySemanticAdditions(repairIR, changes, warnings);
  }

  // G. re-validate the repaired clone
  return finish(repairIR, dryRun, changes, warnings);
}
