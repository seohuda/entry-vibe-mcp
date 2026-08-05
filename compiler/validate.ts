import { readFileSync } from 'node:fs';
import type { BlockCatalog, BlockSchema } from '../src/types/block.ts';
import type { EntryIR, IRBlock, IRParamValue, Thread } from '../src/types/ir.ts';
import { catalogPath } from '../src/paths.ts';
import { normalizeAssetRelPath, resolveHostAsset, resolveHostSound } from './assets.ts';

const DEFAULT_CATALOG = catalogPath();

/** Skeleton of the event hats an object's script thread may start with. */
export const EVENT_SKELETON = 'basic_event';

/** Param key Entry uses for a variable reference (stored as a variable id). */
export const VARIABLE_PARAM_KEY = 'VARIABLE';
/** Param key Entry uses for a list reference (stored as a list/variable id). */
export const LIST_PARAM_KEY = 'LIST';
/**
 * Message blocks use DropdownDynamic param key `VALUE` (not MESSAGE).
 * IR authors pass the message *name*; the compiler rewrites to the message id.
 */
export const MESSAGE_PARAM_KEY = 'VALUE';

/** Pseudo block type for calling an ir.functions[] entry (compiles to func_<id>). */
export const FUNCTION_CALL_TYPE = 'function_call';

const MESSAGE_BLOCK_TYPES = new Set([
  'message_cast',
  'message_cast_wait',
  'when_message_cast',
]);

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  /** Repair hints aligned with errors (host LLM should apply these and retry). */
  hints: string[];
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

function pushError(ctx: ValidateContext, message: string, hint?: string): void {
  ctx.errors.push(message);
  ctx.hints.push(hint ?? 'Fix the IR and call validate_project again.');
}

interface ValidateContext {
  index: Map<string, BlockSchema>;
  variableNames: Set<string>;
  listNames: Set<string>;
  messageNames: Set<string>;
  functionNames: Set<string>;
  errors: string[];
  hints: string[];
}

function validateBlock(
  block: IRBlock,
  path: string,
  ctx: ValidateContext,
  opts: { allowHat: boolean },
): void {
  const { index } = ctx;

  if (block.type === FUNCTION_CALL_TYPE) {
    const name = block.params?.NAME;
    if (typeof name !== 'string' || !name) {
      pushError(
        ctx,
        `${path}: function_call requires params.NAME (function name string)`,
        'Use { "type": "function_call", "params": { "NAME": "<ir.functions[].name>" } }.',
      );
      return;
    }
    if (!ctx.functionNames.has(name)) {
      pushError(
        ctx,
        `${path}: unknown function ${JSON.stringify(name)} — declare it in ir.functions (known: ${[...ctx.functionNames].join(', ') || 'none'})`,
        `Add { "name": ${JSON.stringify(name)}, "type": "statement", "body": [...] } to ir.functions.`,
      );
    }
    if (block.statements && Object.keys(block.statements).length > 0) {
      pushError(ctx, `${path}: function_call does not take statements`);
    }
    return;
  }

  const schema = index.get(block.type);
  if (!schema) {
    pushError(
      ctx,
      `${path}: unknown block type "${block.type}"`,
      'Call search_blocks(scope=core) then get_block_schema for the exact type id.',
    );
    return;
  }

  if (opts.allowHat === false && schema.isHat) {
    pushError(
      ctx,
      `${path}: hat block "${block.type}" cannot appear mid-thread`,
      'Move the event block to the start of the thread, or nest non-hat blocks only.',
    );
  }

  if (block.params) {
    for (const key of Object.keys(block.params)) {
      const paramSchema = schema.params.find((p) => p.key === key);
      if (!paramSchema) {
        pushError(
          ctx,
          `${path}: unknown param key "${key}" on "${block.type}"`,
          `Use get_block_schema(["${block.type}"]) and only set listed param keys.`,
        );
        continue;
      }
      if (paramSchema.type === 'Indicator' || paramSchema.type === 'LineBreak') {
        pushError(
          ctx,
          `${path}: param "${key}" is not user-settable (${paramSchema.type})`,
          'Omit Indicator/LineBreak params — the compiler fills them.',
        );
        continue;
      }
      const value = block.params[key];
      if (isIRBlock(value)) {
        validateBlock(value, `${path}.params.${key}`, ctx, { allowHat: false });
        continue;
      }
      if (key === LIST_PARAM_KEY && !ctx.listNames.has(String(value))) {
        pushError(
          ctx,
          `${path}: unknown list ${JSON.stringify(value)} — declare it in ir.lists (known: ${[...ctx.listNames].join(', ') || 'none'})`,
          `Add { "name": ${JSON.stringify(String(value))}, "initialValues": [] } to ir.lists.`,
        );
        continue;
      }
      if (key === VARIABLE_PARAM_KEY && !ctx.variableNames.has(String(value))) {
        pushError(
          ctx,
          `${path}: unknown variable ${JSON.stringify(value)} — declare it in ir.variables (known: ${[...ctx.variableNames].join(', ') || 'none'})`,
          `Add { "name": ${JSON.stringify(String(value))}, "initialValue": 0 } to ir.variables.`,
        );
        continue;
      }
      if (
        MESSAGE_BLOCK_TYPES.has(block.type) &&
        key === MESSAGE_PARAM_KEY &&
        !ctx.messageNames.has(String(value))
      ) {
        pushError(
          ctx,
          `${path}: unknown message ${JSON.stringify(value)} — declare it in ir.messages (known: ${[...ctx.messageNames].join(', ') || 'none'})`,
          `Add { "name": ${JSON.stringify(String(value))} } to ir.messages.`,
        );
      }
    }
  }

  const statementKeys = new Set(schema.statementKeys);
  if (block.statements) {
    for (const [slot, thread] of Object.entries(block.statements)) {
      if (!statementKeys.has(slot)) {
        pushError(
          ctx,
          `${path}: unknown statement slot "${slot}" on "${block.type}" (expected: ${schema.statementKeys.join(', ') || 'none'})`,
          `Use statementKeys from get_block_schema(["${block.type}"]).`,
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
  const { index } = ctx;
  const { requireHat, allowEmpty } = opts;

  if (!Array.isArray(thread)) {
    pushError(ctx, `${path}: thread must be an array of blocks`);
    return;
  }
  if (thread.length === 0) {
    if (!allowEmpty) {
      pushError(
        ctx,
        `${path}: thread must be a non-empty array of blocks`,
        'Start with when_run_button_click (or another event hat), then action blocks.',
      );
    }
    return;
  }

  if (requireHat) {
    const first = index.get(thread[0].type);
    // Not merely isHat: function_create/function_create_value are hats too, but
    // they head a function definition, not an object's script.
    if (first?.skeleton !== EVENT_SKELETON) {
      pushError(
        ctx,
        `${path}[0]: script thread must start with an event block (got "${thread[0].type}")`,
        'Put when_run_button_click (or when_message_cast / when_clause_*) first in the thread.',
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
  const hints: string[] = [];
  const index = catalogIndex(catalog);

  if (!ir || !Array.isArray(ir.objects) || ir.objects.length === 0) {
    return {
      valid: false,
      errors: ['ir.objects must be a non-empty array'],
      hints: ['Provide at least one object with name, sprite: "entrybot", and scripts.'],
    };
  }

  const variableNames = new Set<string>();
  (ir.variables ?? []).forEach((v, vi) => {
    if (!v?.name || typeof v.name !== 'string') {
      errors.push(`variables[${vi}].name is required`);
      hints.push('Each variable needs a non-empty name string.');
      return;
    }
    if (variableNames.has(v.name)) {
      errors.push(`variables[${vi}]: duplicate variable name ${JSON.stringify(v.name)}`);
      hints.push('Variable names must be unique.');
      return;
    }
    variableNames.add(v.name);
  });

  const listNames = new Set<string>();
  (ir.lists ?? []).forEach((l, li) => {
    if (!l?.name || typeof l.name !== 'string') {
      errors.push(`lists[${li}].name is required`);
      hints.push('Each list needs a non-empty name string.');
      return;
    }
    if (listNames.has(l.name)) {
      errors.push(`lists[${li}]: duplicate list name ${JSON.stringify(l.name)}`);
      hints.push('List names must be unique.');
      return;
    }
    listNames.add(l.name);
  });

  const messageNames = new Set<string>();
  (ir.messages ?? []).forEach((m, mi) => {
    if (!m?.name || typeof m.name !== 'string') {
      errors.push(`messages[${mi}].name is required`);
      hints.push('Each message needs a non-empty name string.');
      return;
    }
    if (messageNames.has(m.name)) {
      errors.push(`messages[${mi}]: duplicate message name ${JSON.stringify(m.name)}`);
      hints.push('Message names must be unique.');
      return;
    }
    messageNames.add(m.name);
  });

  const functionNames = new Set<string>();
  (ir.functions ?? []).forEach((fn, fi) => {
    if (!fn?.name || typeof fn.name !== 'string') {
      errors.push(`functions[${fi}].name is required`);
      hints.push('Each function needs a non-empty name string.');
      return;
    }
    if (functionNames.has(fn.name)) {
      errors.push(`functions[${fi}]: duplicate function name ${JSON.stringify(fn.name)}`);
      hints.push('Function names must be unique.');
      return;
    }
    functionNames.add(fn.name);
  });

  const ctx: ValidateContext = {
    index,
    variableNames,
    listNames,
    messageNames,
    functionNames,
    errors,
    hints,
  };

  (ir.functions ?? []).forEach((fn, fi) => {
    const prefix = `functions[${fi}]`;
    const fnType = fn.type ?? 'statement';
    if (!['statement', 'string', 'boolean'].includes(fnType)) {
      pushError(
        ctx,
        `${prefix}.type must be statement|string|boolean`,
        'Use "statement" for void functions, "string"/"boolean" for value-returning ones.',
      );
    }
    if (!Array.isArray(fn.body)) {
      pushError(ctx, `${prefix}.body must be an array of blocks (no event hat)`);
    } else {
      validateThread(fn.body, `${prefix}.body`, ctx, {
        requireHat: false,
        allowEmpty: true,
      });
    }
    if (fnType === 'string' || fnType === 'boolean') {
      if (fn.returnValue === undefined) {
        pushError(
          ctx,
          `${prefix}.returnValue is required when type is ${fnType}`,
          'Set returnValue to a literal or nested IRBlock expression.',
        );
      } else if (isIRBlock(fn.returnValue)) {
        validateBlock(fn.returnValue, `${prefix}.returnValue`, ctx, { allowHat: false });
      }
    }
  });

  ir.objects.forEach((obj, oi) => {
    if (!obj.name || typeof obj.name !== 'string') {
      pushError(ctx, `objects[${oi}].name is required`);
    }
    if (obj.sprite !== 'entrybot') {
      pushError(
        ctx,
        `objects[${oi}].sprite must be "entrybot" (got ${JSON.stringify(obj.sprite)})`,
        'Use sprite: "entrybot". Customize look via pictures/sounds under assets/.',
      );
    }
    if (obj.x !== undefined && typeof obj.x !== 'number') {
      pushError(ctx, `objects[${oi}].x must be a number when provided`);
    }
    if (obj.y !== undefined && typeof obj.y !== 'number') {
      pushError(ctx, `objects[${oi}].y must be a number when provided`);
    }
    if (obj.pictures !== undefined) {
      if (!Array.isArray(obj.pictures) || obj.pictures.length === 0) {
        pushError(
          ctx,
          `objects[${oi}].pictures must be a non-empty array when provided ` +
            '(or omit it to use the built-in entrybot costumes)',
        );
      } else {
        obj.pictures.forEach((pic, pi) => {
          const prefix = `objects[${oi}].pictures[${pi}]`;
          if (!pic || typeof pic.path !== 'string') {
            pushError(ctx, `${prefix}.path is required`);
            return;
          }
          try {
            normalizeAssetRelPath(pic.path, 'image');
            resolveHostAsset(pic.path);
          } catch (err) {
            pushError(
              ctx,
              `${prefix}: ${err instanceof Error ? err.message : String(err)}`,
              'Write a png/svg under the host assets/ folder and reference assets/...',
            );
          }
        });
      }
    }
    if (obj.sounds !== undefined) {
      if (!Array.isArray(obj.sounds) || obj.sounds.length === 0) {
        pushError(
          ctx,
          `objects[${oi}].sounds must be a non-empty array when provided ` +
            '(or omit it to use the built-in bark sound)',
        );
      } else {
        obj.sounds.forEach((snd, si) => {
          const prefix = `objects[${oi}].sounds[${si}]`;
          if (!snd || typeof snd.path !== 'string') {
            pushError(ctx, `${prefix}.path is required`);
            return;
          }
          if (snd.duration !== undefined && (typeof snd.duration !== 'number' || !(snd.duration > 0))) {
            pushError(ctx, `${prefix}.duration must be a positive number when provided`);
          }
          try {
            normalizeAssetRelPath(snd.path, 'sound');
            resolveHostSound(snd.path);
          } catch (err) {
            pushError(
              ctx,
              `${prefix}: ${err instanceof Error ? err.message : String(err)}`,
              'Write an mp3 under the host assets/ folder and reference assets/....mp3',
            );
          }
        });
      }
    }
    if (!Array.isArray(obj.scripts) || obj.scripts.length === 0) {
      pushError(
        ctx,
        `objects[${oi}].scripts must be a non-empty array of threads`,
        'Each object needs at least one thread starting with an event hat.',
      );
      return;
    }
    obj.scripts.forEach((thread, ti) => {
      validateThread(thread, `objects[${oi}].scripts[${ti}]`, ctx, {
        requireHat: true,
        allowEmpty: false,
      });
    });
  });

  return { valid: errors.length === 0, errors, hints };
}

export { MESSAGE_BLOCK_TYPES };
