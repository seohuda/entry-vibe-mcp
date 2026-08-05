import { readFileSync } from 'node:fs';
import type { BlockCatalog, BlockSchema } from '../src/types/block.ts';
import type { EntryIR, IRBlock, IRParamValue, Thread } from '../src/types/ir.ts';
import { catalogPath } from '../src/paths.ts';
import { normalizeAssetRelPath, resolveHostAsset } from './assets.ts';

const DEFAULT_CATALOG = catalogPath();

/** Skeleton of the event hats an object's script thread may start with. */
export const EVENT_SKELETON = 'basic_event';

/** Param key Entry uses for a variable reference (stored as a variable id). */
export const VARIABLE_PARAM_KEY = 'VARIABLE';
/** Param key Entry uses for a list reference (stored as a list/variable id). */
export const LIST_PARAM_KEY = 'LIST';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

let cachedCatalog: BlockCatalog | null = null;
let cachedPath: string | null = null;

export function loadCatalog(path: string = DEFAULT_CATALOG): BlockCatalog {
  if (cachedCatalog && cachedPath === path) return cachedCatalog;
  const catalog = JSON.parse(readFileSync(path, 'utf8')) as BlockCatalog;
  cachedCatalog = catalog;
  cachedPath = path;
  return catalog;
}

export function catalogIndex(
  catalog: BlockCatalog = loadCatalog(),
): Map<string, BlockSchema> {
  return new Map(catalog.blocks.map((b) => [b.type, b]));
}

function isIRBlock(value: IRParamValue): value is IRBlock {
  return typeof value === 'object' && value !== null && 'type' in value;
}

interface ValidateContext {
  index: Map<string, BlockSchema>;
  /** Declared user variable names (ir.variables[].name). */
  variableNames: Set<string>;
  /** Declared user list names (ir.lists[].name). */
  listNames: Set<string>;
  errors: string[];
}

function validateBlock(
  block: IRBlock,
  path: string,
  ctx: ValidateContext,
  opts: { allowHat: boolean },
): void {
  const { index, errors } = ctx;
  const schema = index.get(block.type);
  if (!schema) {
    errors.push(`${path}: unknown block type "${block.type}"`);
    return;
  }

  if (opts.allowHat === false && schema.isHat) {
    errors.push(`${path}: hat block "${block.type}" cannot appear mid-thread`);
  }

  if (block.params) {
    for (const key of Object.keys(block.params)) {
      const paramSchema = schema.params.find((p) => p.key === key);
      if (!paramSchema) {
        errors.push(`${path}: unknown param key "${key}" on "${block.type}"`);
        continue;
      }
      if (paramSchema.type === 'Indicator' || paramSchema.type === 'LineBreak') {
        errors.push(`${path}: param "${key}" is not user-settable (${paramSchema.type})`);
        continue;
      }
      const value = block.params[key];
      if (isIRBlock(value)) {
        validateBlock(value, `${path}.params.${key}`, ctx, { allowHat: false });
        continue;
      }
      if (key === LIST_PARAM_KEY && !ctx.listNames.has(String(value))) {
        errors.push(
          `${path}: unknown list ${JSON.stringify(value)} — declare it in ir.lists (known: ${[...ctx.listNames].join(', ') || 'none'})`,
        );
        continue;
      }
      if (key === VARIABLE_PARAM_KEY && !ctx.variableNames.has(String(value))) {
        errors.push(
          `${path}: unknown variable ${JSON.stringify(value)} — declare it in ir.variables (known: ${[...ctx.variableNames].join(', ') || 'none'})`,
        );
      }
    }
  }

  const statementKeys = new Set(schema.statementKeys);
  if (block.statements) {
    for (const [slot, thread] of Object.entries(block.statements)) {
      if (!statementKeys.has(slot)) {
        errors.push(
          `${path}: unknown statement slot "${slot}" on "${block.type}" (expected: ${schema.statementKeys.join(', ') || 'none'})`,
        );
        continue;
      }
      validateThread(thread, `${path}.statements.${slot}`, ctx, {
        requireHat: false,
        allowEmpty: true,
      });
    }
  }
}

function validateThread(
  thread: Thread,
  path: string,
  ctx: ValidateContext,
  opts: { requireHat: boolean; allowEmpty: boolean },
): void {
  const { index, errors } = ctx;
  const { requireHat, allowEmpty } = opts;

  if (!Array.isArray(thread)) {
    errors.push(`${path}: thread must be an array of blocks`);
    return;
  }
  if (thread.length === 0) {
    // An empty statement slot is legal in Entry (e.g. a loop with no body).
    if (!allowEmpty) {
      errors.push(`${path}: thread must be a non-empty array of blocks`);
    }
    return;
  }

  if (requireHat) {
    const first = index.get(thread[0].type);
    // Not merely isHat: function_create/function_create_value are hats too, but
    // they head a function definition, not an object's script.
    if (first?.skeleton !== EVENT_SKELETON) {
      errors.push(
        `${path}[0]: script thread must start with an event block (got "${thread[0].type}")`,
      );
    }
  }

  thread.forEach((block, i) => {
    validateBlock(block, `${path}[${i}]`, ctx, {
      allowHat: requireHat && i === 0,
    });
  });
}

export function validateProject(
  ir: EntryIR,
  catalog: BlockCatalog = loadCatalog(),
): ValidationResult {
  const errors: string[] = [];
  const index = catalogIndex(catalog);

  if (!ir || !Array.isArray(ir.objects) || ir.objects.length === 0) {
    errors.push('ir.objects must be a non-empty array');
    return { valid: false, errors };
  }

  const variableNames = new Set<string>();
  (ir.variables ?? []).forEach((v, vi) => {
    if (!v?.name || typeof v.name !== 'string') {
      errors.push(`variables[${vi}].name is required`);
      return;
    }
    if (variableNames.has(v.name)) {
      errors.push(`variables[${vi}]: duplicate variable name ${JSON.stringify(v.name)}`);
      return;
    }
    variableNames.add(v.name);
  });

  const listNames = new Set<string>();
  (ir.lists ?? []).forEach((l, li) => {
    if (!l?.name || typeof l.name !== 'string') {
      errors.push(`lists[${li}].name is required`);
      return;
    }
    if (listNames.has(l.name)) {
      errors.push(`lists[${li}]: duplicate list name ${JSON.stringify(l.name)}`);
      return;
    }
    listNames.add(l.name);
  });

  const ctx: ValidateContext = { index, variableNames, listNames, errors };

  ir.objects.forEach((obj, oi) => {
    if (!obj.name || typeof obj.name !== 'string') {
      errors.push(`objects[${oi}].name is required`);
    }
    if (obj.sprite !== 'entrybot') {
      errors.push(
        `objects[${oi}].sprite must be "entrybot" in v1 (got ${JSON.stringify(obj.sprite)})`,
      );
    }
    if (obj.pictures !== undefined) {
      if (!Array.isArray(obj.pictures) || obj.pictures.length === 0) {
        errors.push(
          `objects[${oi}].pictures must be a non-empty array when provided ` +
            '(or omit it to use the built-in entrybot costumes)',
        );
      } else {
        obj.pictures.forEach((pic, pi) => {
          const prefix = `objects[${oi}].pictures[${pi}]`;
          if (!pic || typeof pic.path !== 'string') {
            errors.push(`${prefix}.path is required`);
            return;
          }
          try {
            normalizeAssetRelPath(pic.path);
            resolveHostAsset(pic.path);
          } catch (err) {
            errors.push(`${prefix}: ${err instanceof Error ? err.message : String(err)}`);
          }
        });
      }
    }
    if (!Array.isArray(obj.scripts) || obj.scripts.length === 0) {
      errors.push(`objects[${oi}].scripts must be a non-empty array of threads`);
      return;
    }
    obj.scripts.forEach((thread, ti) => {
      validateThread(thread, `objects[${oi}].scripts[${ti}]`, ctx, {
        requireHat: true,
        allowEmpty: false,
      });
    });
  });

  return { valid: errors.length === 0, errors };
}
