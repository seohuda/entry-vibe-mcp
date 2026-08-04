import { readFileSync } from 'node:fs';
import type { BlockCatalog, BlockSchema } from '../src/types/block.ts';
import type { EntryIR, IRBlock, IRParamValue, Thread } from '../src/types/ir.ts';
import { catalogPath } from '../src/paths.ts';

const DEFAULT_CATALOG = catalogPath();

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

function validateBlock(
  block: IRBlock,
  path: string,
  index: Map<string, BlockSchema>,
  errors: string[],
  opts: { allowHat: boolean },
): void {
  const schema = index.get(block.type);
  if (!schema) {
    errors.push(`${path}: unknown block type "${block.type}"`);
    return;
  }

  if (opts.allowHat === false && schema.isHat) {
    errors.push(`${path}: hat block "${block.type}" cannot appear mid-thread`);
  }

  const writableKeys = new Set(
    schema.params
      .filter((p) => p.type !== 'Indicator' && p.type !== 'LineBreak')
      .map((p) => p.key),
  );

  if (block.params) {
    for (const key of Object.keys(block.params)) {
      if (!writableKeys.has(key) && !schema.params.some((p) => p.key === key)) {
        errors.push(`${path}: unknown param key "${key}" on "${block.type}"`);
        continue;
      }
      const paramSchema = schema.params.find((p) => p.key === key);
      if (paramSchema && (paramSchema.type === 'Indicator' || paramSchema.type === 'LineBreak')) {
        errors.push(`${path}: param "${key}" is not user-settable (${paramSchema.type})`);
        continue;
      }
      const value = block.params[key];
      if (isIRBlock(value)) {
        validateBlock(value, `${path}.params.${key}`, index, errors, { allowHat: false });
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
      validateThread(thread, `${path}.statements.${slot}`, index, errors, false);
    }
  }
}

function validateThread(
  thread: Thread,
  path: string,
  index: Map<string, BlockSchema>,
  errors: string[],
  requireHat: boolean,
): void {
  if (!Array.isArray(thread) || thread.length === 0) {
    errors.push(`${path}: thread must be a non-empty array of blocks`);
    return;
  }

  if (requireHat) {
    const first = index.get(thread[0].type);
    if (!first?.isHat) {
      errors.push(
        `${path}[0]: script thread must start with a hat/event block (got "${thread[0].type}")`,
      );
    }
  }

  thread.forEach((block, i) => {
    validateBlock(block, `${path}[${i}]`, index, errors, {
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

  ir.objects.forEach((obj, oi) => {
    if (!obj.name || typeof obj.name !== 'string') {
      errors.push(`objects[${oi}].name is required`);
    }
    if (obj.sprite !== 'entrybot') {
      errors.push(
        `objects[${oi}].sprite must be "entrybot" in v1 (got ${JSON.stringify(obj.sprite)})`,
      );
    }
    if (!Array.isArray(obj.scripts) || obj.scripts.length === 0) {
      errors.push(`objects[${oi}].scripts must be a non-empty array of threads`);
      return;
    }
    obj.scripts.forEach((thread, ti) => {
      validateThread(thread, `objects[${oi}].scripts[${ti}]`, index, errors, true);
    });
  });

  return { valid: errors.length === 0, errors };
}
