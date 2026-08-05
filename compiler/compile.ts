import type { BlockCatalog, BlockParamSchema, BlockSchema } from '../src/types/block.ts';
import type { EntryIR, IRBlock, IRParamValue, Thread } from '../src/types/ir.ts';
import { createStartProjectSkeleton, type EntryProject } from './skeleton.ts';
import {
  defaultMediaName,
  hostAssetMarker,
  readImageDimension,
  resolveHostAsset,
  resolveHostSound,
} from './assets.ts';
import {
  catalogIndex,
  loadCatalog,
  validateProject,
  LIST_PARAM_KEY,
  VARIABLE_PARAM_KEY,
} from './validate.ts';

/** Collect Entry extension module lists from every block referenced in the IR. */
export function collectExtensionModules(
  ir: EntryIR,
  index: Map<string, BlockSchema>,
): {
  aiUtilizeBlocks: string[];
  expansionBlocks: string[];
  hardwareLiteBlocks: string[];
  externalModules: string[];
} {
  const aiUtilize = new Set<string>();
  const expansion = new Set<string>();
  const hardwareLite = new Set<string>();
  const external = new Set<string>();

  const visit = (block: IRBlock) => {
    const schema = index.get(block.type);
    const ext = schema?.extension;
    if (ext) {
      switch (ext.kind) {
        case 'aiUtilize':
          aiUtilize.add(ext.module);
          break;
        case 'expansion':
          expansion.add(ext.module);
          break;
        case 'hardwareLite':
          hardwareLite.add(ext.module);
          break;
        case 'hardware':
          external.add(ext.module);
          break;
        // aiLearning needs project.learning model data — catalog-only for now
        default:
          break;
      }
    }
    if (block.params) {
      for (const value of Object.values(block.params)) {
        if (isIRBlock(value)) visit(value);
      }
    }
    if (block.statements) {
      for (const thread of Object.values(block.statements)) {
        for (const child of thread) visit(child);
      }
    }
  };

  for (const obj of ir.objects) {
    for (const thread of obj.scripts) {
      for (const block of thread) visit(block);
    }
  }

  return {
    aiUtilizeBlocks: [...aiUtilize].sort(),
    expansionBlocks: [...expansion].sort(),
    hardwareLiteBlocks: [...hardwareLite].sort(),
    externalModules: [...external].sort(),
  };
}

export class CompileError extends Error {
  constructor(public readonly errors: string[]) {
    super(errors.join('\n'));
    this.name = 'CompileError';
  }
}

const THREAD_X = 40;
const THREAD_Y_START = 50;
const THREAD_Y_GAP = 200;

const ID_CHARS = '0123456789abcdefghijklmnopqrstuvwxyz';

/**
 * Deterministic generator for Entry-shaped 4-char ids.
 * Entry requires object / picture / sound / variable ids to be unique across the
 * whole project, so every clone of the skeleton object must get fresh ones.
 */
function createIdFactory(reserved: Iterable<string> = []): () => string {
  const used = new Set(reserved);
  let counter = 0;
  return function nextId(): string {
    for (;;) {
      let value = counter++;
      let id = '';
      for (let i = 0; i < 4; i++) {
        id = ID_CHARS[value % ID_CHARS.length] + id;
        value = Math.floor(value / ID_CHARS.length);
      }
      if (!used.has(id)) {
        used.add(id);
        return id;
      }
    }
  };
}

interface SkeletonSprite {
  pictures: Array<Record<string, unknown>>;
  sounds: Array<Record<string, unknown>>;
}

function isIRBlock(value: IRParamValue): value is IRBlock {
  return typeof value === 'object' && value !== null && 'type' in value;
}

/**
 * Wrap a literal in the primitive block Entry expects for a value slot.
 * Only reached for non-dropdown params — compileParamValue passes dropdown
 * values through untouched.
 */
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
  return { type: 'text', params: [String(value)] };
}

interface CompileContext {
  index: Map<string, BlockSchema>;
  /** Variable name → generated project variable id. */
  variableIds: Map<string, string>;
  /** List name → generated project list id. */
  listIds: Map<string, string>;
}

function compileParamValue(
  value: IRParamValue,
  param: BlockParamSchema,
  ctx: CompileContext,
): unknown {
  if (isIRBlock(value)) {
    return compileBlock(value, ctx, { includePosition: false });
  }
  // Entry stores variable/list references as ids, but IR authors only know names.
  if (param.key === VARIABLE_PARAM_KEY && typeof value === 'string') {
    return ctx.variableIds.get(value) ?? value;
  }
  if (param.key === LIST_PARAM_KEY && typeof value === 'string') {
    return ctx.listIds.get(value) ?? value;
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
  ctx: CompileContext,
  opts: { includePosition: boolean; x?: number; y?: number },
): Record<string, unknown> {
  const schema = ctx.index.get(block.type);
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
        return compileParamValue(block.params[param.key], param, ctx);
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
      statements.push(compileThreadBody(thread, ctx));
    }
    out.statements = statements;
  }

  return out;
}

/** Compile blocks inside a statement slot (no x/y). */
function compileThreadBody(
  thread: Thread,
  ctx: CompileContext,
): Record<string, unknown>[] {
  return thread.map((b) => compileBlock(b, ctx, { includePosition: false }));
}

/** Compile a top-level script thread (first block gets x/y). */
function compileTopThread(
  thread: Thread,
  ctx: CompileContext,
  x: number,
  y: number,
): Record<string, unknown>[] {
  return thread.map((b, i) =>
    compileBlock(b, ctx, {
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
  project.name = ir.objects[0]?.name ? `${ir.objects[0].name} 프로젝트` : '엔트리 프로젝트';

  const sceneId = project.scenes[0].id;
  const nextId = createIdFactory([
    sceneId,
    ...project.variables.map((v) => String(v.id)),
  ]);

  // User variables are created before scripts: blocks reference them by id,
  // so the name → id mapping must exist while compiling params.
  const variableIds = new Map<string, string>();
  for (const v of ir.variables ?? []) {
    const id = nextId();
    variableIds.set(v.name, id);
    project.variables.push({
      name: v.name,
      id,
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

  // Entry stores lists in the same `variables` array as plain variables,
  // disambiguated by variableType: 'list' with an `array` of { data } items.
  const listIds = new Map<string, string>();
  for (const l of ir.lists ?? []) {
    const id = nextId();
    listIds.set(l.name, id);
    project.variables.push({
      name: l.name,
      id,
      visible: false,
      value: '0',
      variableType: 'list',
      x: 0,
      y: 0,
      width: 100,
      height: 120,
      array: (l.initialValues ?? []).map((data) => ({ data: String(data) })),
      object: null,
      isCloud: false,
    });
  }

  const ctx: CompileContext = { index, variableIds, listIds };

  // Replace objects from IR
  const template = project.objects[0];
  project.objects = ir.objects.map((obj) => {
    const base = structuredClone(template) as Record<string, unknown>;
    base.id = nextId();
    base.name = obj.name;
    base.label = { ko: obj.name, en: obj.name };
    base.scene = sceneId;

    // Picture/sound ids must be unique project-wide, not just per object.
    const sprite = base.sprite as SkeletonSprite;
    if (obj.pictures && obj.pictures.length > 0) {
      sprite.pictures = obj.pictures.map((pic) => {
        const resolved = resolveHostAsset(pic.path);
        const dimension = readImageDimension(resolved.absolutePath, resolved.imageType);
        return {
          id: nextId(),
          fileurl: hostAssetMarker(resolved.relativePath),
          thumbUrl: hostAssetMarker(resolved.relativePath),
          name: defaultMediaName(resolved.relativePath, pic.name),
          imageType: resolved.imageType,
          dimension,
        };
      });
      const first = sprite.pictures[0];
      const dim = first.dimension as { width: number; height: number };
      const entity = base.entity as Record<string, number>;
      entity.width = dim.width;
      entity.height = dim.height;
      entity.regX = dim.width / 2;
      entity.regY = dim.height / 2;
      // Skeleton keeps Entrybot's ~0.51 scale for the built-in 144×246 art.
      // Custom costumes should render at their native pixel size.
      entity.scaleX = 1;
      entity.scaleY = 1;
    } else {
      sprite.pictures.forEach((picture) => {
        picture.id = nextId();
      });
    }
    if (obj.sounds && obj.sounds.length > 0) {
      sprite.sounds = obj.sounds.map((snd) => {
        const resolved = resolveHostSound(snd.path);
        return {
          id: nextId(),
          fileurl: hostAssetMarker(resolved.relativePath),
          name: defaultMediaName(resolved.relativePath, snd.name),
          ext: '.mp3',
          duration: snd.duration && snd.duration > 0 ? snd.duration : 1,
        };
      });
    } else {
      sprite.sounds.forEach((sound) => {
        sound.id = nextId();
      });
    }
    base.selectedPictureId = sprite.pictures[0]?.id;

    const scripts = obj.scripts.map((thread, ti) =>
      compileTopThread(thread, ctx, THREAD_X + ti * 300, THREAD_Y_START + ti * THREAD_Y_GAP),
    );
    base.script = scripts;
    return base;
  });

  const extensions = collectExtensionModules(ir, index);
  project.aiUtilizeBlocks = extensions.aiUtilizeBlocks;
  project.expansionBlocks = extensions.expansionBlocks;
  project.hardwareLiteBlocks = extensions.hardwareLiteBlocks;
  project.externalModules = extensions.externalModules;

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
