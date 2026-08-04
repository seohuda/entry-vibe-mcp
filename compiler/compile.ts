import type { BlockCatalog, BlockParamSchema, BlockSchema } from '../src/types/block.ts';
import type { EntryIR, IRBlock, IRParamValue, Thread } from '../src/types/ir.ts';
import { createStartProjectSkeleton, type EntryProject } from './skeleton.ts';
import { catalogIndex, loadCatalog, validateProject } from './validate.ts';

export class CompileError extends Error {
  constructor(public readonly errors: string[]) {
    super(errors.join('\n'));
    this.name = 'CompileError';
  }
}

const THREAD_X = 40;
const THREAD_Y_START = 50;
const THREAD_Y_GAP = 200;

function isIRBlock(value: IRParamValue): value is IRBlock {
  return typeof value === 'object' && value !== null && 'type' in value;
}

function wrapPrimitive(
  value: string | number | boolean,
  param: BlockParamSchema,
): unknown {
  if (typeof value === 'boolean') {
    return { type: value ? 'True' : 'False' };
  }

  const defaultType = param.defaultType ?? (typeof value === 'number' ? 'number' : 'text');
  if (defaultType === 'number' || typeof value === 'number') {
    return { type: 'number', params: [String(value)] };
  }
  if (param.type === 'Dropdown' || param.type === 'DropdownDynamic' || param.type === 'Keyboard') {
    return value;
  }
  return { type: 'text', params: [String(value)] };
}

function compileParamValue(
  value: IRParamValue,
  param: BlockParamSchema,
  index: Map<string, BlockSchema>,
): unknown {
  if (isIRBlock(value)) {
    return compileBlock(value, index, { includePosition: false });
  }
  if (param.type === 'Dropdown' || param.type === 'DropdownDynamic' || param.type === 'Keyboard') {
    return value;
  }
  return wrapPrimitive(value, param);
}

function defaultForParam(param: BlockParamSchema): unknown {
  if (param.type === 'Indicator' || param.type === 'LineBreak') return null;
  if (param.defaultValue !== undefined) return param.defaultValue;
  if (param.type === 'Dropdown' && param.options?.[0]) return param.options[0].value;
  return null;
}

function compileBlock(
  block: IRBlock,
  index: Map<string, BlockSchema>,
  opts: { includePosition: boolean; x?: number; y?: number },
): Record<string, unknown> {
  const schema = index.get(block.type);
  if (!schema) {
    throw new CompileError([`unknown block type "${block.type}"`]);
  }

  const out: Record<string, unknown> = { type: block.type };

  if (opts.includePosition) {
    out.x = opts.x ?? THREAD_X;
    out.y = opts.y ?? THREAD_Y_START;
  }

  // Build positional params array
  if (schema.params.length > 0) {
    const params: unknown[] = schema.params.map((param) => {
      if (param.type === 'Indicator' || param.type === 'LineBreak') return null;
      if (block.params && Object.prototype.hasOwnProperty.call(block.params, param.key)) {
        return compileParamValue(block.params[param.key], param, index);
      }
      return defaultForParam(param);
    });

    // Omit params entirely if everything is null/default-empty and IR didn't specify any
    // — keep them when IR specified params or when defaults are meaningful nested blocks
    const hasUserParams = block.params && Object.keys(block.params).length > 0;
    const hasNonNull = params.some((p) => p !== null);
    if (hasUserParams || hasNonNull) {
      out.params = params;
    }
  }

  if (schema.statementSlots > 0) {
    const statements: unknown[][] = [];
    for (let i = 0; i < schema.statementSlots; i++) {
      const key = schema.statementKeys[i] ?? String(i);
      const thread = block.statements?.[key] ?? [];
      statements.push(compileThreadBody(thread, index));
    }
    out.statements = statements;
  }

  return out;
}

/** Compile blocks inside a statement slot (no x/y). */
function compileThreadBody(
  thread: Thread,
  index: Map<string, BlockSchema>,
): Record<string, unknown>[] {
  return thread.map((b) => compileBlock(b, index, { includePosition: false }));
}

/** Compile a top-level script thread (first block gets x/y). */
function compileTopThread(
  thread: Thread,
  index: Map<string, BlockSchema>,
  x: number,
  y: number,
): Record<string, unknown>[] {
  return thread.map((b, i) =>
    compileBlock(b, index, {
      includePosition: i === 0,
      x,
      y,
    }),
  );
}

export interface CompileOptions {
  catalog?: BlockCatalog;
  /** When true (default), throw CompileError on validation failure. */
  strict?: boolean;
}

export function compileProject(ir: EntryIR, options: CompileOptions = {}): EntryProject {
  const catalog = options.catalog ?? loadCatalog();
  const strict = options.strict !== false;

  const validation = validateProject(ir, catalog);
  if (!validation.valid && strict) {
    throw new CompileError(validation.errors);
  }

  const index = catalogIndex(catalog);
  const project = createStartProjectSkeleton();

  // Replace objects from IR
  project.objects = ir.objects.map((obj, oi) => {
    const base = structuredClone(project.objects[0]) as Record<string, unknown>;
    base.id = oi === 0 ? '7y0y' : `obj${oi}`;
    base.name = obj.name;
    base.label = { ko: obj.name, en: obj.name };
    base.scene = (project.scenes[0] as { id: string }).id;

    const scripts = obj.scripts.map((thread, ti) =>
      compileTopThread(thread, index, THREAD_X + ti * 300, THREAD_Y_START + ti * THREAD_Y_GAP),
    );
    base.script = scripts;
    return base;
  });

  // Optional user variables (append after timer/answer)
  if (ir.variables?.length) {
    for (const [i, v] of ir.variables.entries()) {
      project.variables.push({
        name: v.name,
        id: `uv${i}`,
        visible: false,
        value: String(v.initialValue),
        variableType: 'variable',
        x: 0,
        y: 0,
        array: [],
        object: null,
        isCloud: false,
      });
    }
  }

  return project;
}

/**
 * Prepare project for .ent serialization: stringify each object's script
 * (matches Entry.exportProject / offline save format).
 */
export function projectForExport(project: EntryProject): EntryProject {
  const cloned = structuredClone(project);
  for (const obj of cloned.objects) {
    if (Array.isArray(obj.script)) {
      obj.script = JSON.stringify(obj.script);
    }
  }
  return cloned;
}
