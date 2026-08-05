import type { BlockCatalog, BlockParamSchema, BlockSchema } from '../src/types/block.ts';
import type {
  EntryIR,
  EntryIRScene,
  EntryIRObject,
  IRBlock,
  IRParamValue,
  IRPicture,
  Thread,
} from '../src/types/ir.ts';
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
  MESSAGE_PARAM_KEY,
  MESSAGE_BLOCK_TYPES,
  FUNCTION_CALL_TYPE,
} from './validate.ts';
import type { EntryIRFunction } from '../src/types/ir.ts';
import { compileLearning } from './learning.ts';

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
        case 'aiLearning':
          // project.learning is set from ir.learning — no separate module list in Entry export
          break;
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
  for (const fn of ir.functions ?? []) {
    for (const block of fn.body ?? []) visit(block);
    if (fn.returnValue && isIRBlock(fn.returnValue)) visit(fn.returnValue);
  }

  return {
    aiUtilizeBlocks: [...aiUtilize].sort(),
    expansionBlocks: [...expansion].sort(),
    hardwareLiteBlocks: [...hardwareLite].sort(),
    externalModules: [...external].sort(),
  };
}

export class CompileError extends Error {
  constructor(
    public readonly errors: string[],
    public readonly hints: string[] = [],
  ) {
    super(errors.join('\n'));
    this.name = 'CompileError';
  }
}

const THREAD_X = 40;
const THREAD_Y_START = 50;
const THREAD_Y_GAP = 200;
const STAGE_W = 960;
const STAGE_H = 540;

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
  /** Message name → generated project message id. */
  messageIds: Map<string, string>;
  /** Function name → generated func_<id> block type suffix id. */
  functionIds: Map<string, string>;
}

function compileParamValue(
  value: IRParamValue,
  param: BlockParamSchema,
  ctx: CompileContext,
  parentType?: string,
): unknown {
  if (isIRBlock(value)) {
    return compileBlock(value, ctx, { includePosition: false });
  }
  // Entry stores variable/list/message references as ids, but IR authors only know names.
  if (param.key === VARIABLE_PARAM_KEY && typeof value === 'string') {
    return ctx.variableIds.get(value) ?? value;
  }
  if (param.key === LIST_PARAM_KEY && typeof value === 'string') {
    return ctx.listIds.get(value) ?? value;
  }
  if (
    parentType &&
    MESSAGE_BLOCK_TYPES.has(parentType) &&
    param.key === MESSAGE_PARAM_KEY &&
    typeof value === 'string'
  ) {
    return ctx.messageIds.get(value) ?? value;
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
  if (block.type === FUNCTION_CALL_TYPE) {
    const name = String(block.params?.NAME ?? '');
    const id = ctx.functionIds.get(name);
    if (!id) {
      throw new CompileError([`unknown function "${name}"`]);
    }
    const out: Record<string, unknown> = { type: `func_${id}` };
    if (opts.includePosition) {
      out.x = opts.x ?? THREAD_X;
      out.y = opts.y ?? THREAD_Y_START;
    }
    return out;
  }

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
        return compileParamValue(block.params[param.key], param, ctx, block.type);
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

function compileReturnValue(value: IRParamValue, ctx: CompileContext): unknown {
  if (isIRBlock(value)) {
    return compileBlock(value, ctx, { includePosition: false });
  }
  if (typeof value === 'boolean') {
    return { type: value ? 'True' : 'False' };
  }
  if (typeof value === 'number') {
    return { type: 'number', params: [String(value)] };
  }
  return { type: 'text', params: [String(value)] };
}

function compileFunctionDef(
  fn: EntryIRFunction,
  id: string,
  ctx: CompileContext,
): Record<string, unknown> {
  const fnType = fn.type ?? 'statement';
  const body = compileThreadBody(fn.body ?? [], ctx);
  const field = {
    type: 'function_field_label',
    params: [fn.name],
  };

  let content: unknown[][];
  if (fnType === 'statement') {
    content = [
      [
        {
          type: 'function_create',
          x: THREAD_X,
          y: THREAD_Y_START,
          params: [field, null],
          statements: [body],
        },
      ],
    ];
  } else {
    content = [
      [
        {
          type: 'function_create_value',
          x: THREAD_X,
          y: THREAD_Y_START,
          params: [field, null, null, compileReturnValue(fn.returnValue ?? '', ctx)],
          statements: [body],
        },
      ],
    ];
  }

  return {
    id,
    type: 'normal',
    content: JSON.stringify(content),
  };
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

function resolveScenes(ir: EntryIR): EntryIRScene[] {
  if (ir.scenes && ir.scenes.length > 0) return ir.scenes;
  return [{ name: '장면 1' }];
}

function buildHostPicture(
  pic: IRPicture,
  nextId: () => string,
): Record<string, unknown> {
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
}

function compileBackgroundObject(
  sceneId: string,
  background: IRPicture,
  nextId: () => string,
): Record<string, unknown> {
  const picture = buildHostPicture(background, nextId);
  const dim = picture.dimension as { width: number; height: number };
  const scale = Math.max(STAGE_W / dim.width, STAGE_H / dim.height);
  const bgName = background.name ?? '배경';
  return {
    id: nextId(),
    name: bgName,
    label: { ko: bgName, en: bgName },
    objectType: 'sprite',
    rotateMethod: 'none',
    scene: sceneId,
    lock: true,
    active: true,
    selectedPictureId: picture.id,
    sprite: {
      sounds: [],
      pictures: [picture],
    },
    entity: {
      x: 0,
      y: 0,
      regX: dim.width / 2,
      regY: dim.height / 2,
      scaleX: scale,
      scaleY: scale,
      rotation: 0,
      direction: 90,
      width: dim.width,
      height: dim.height,
      visible: true,
    },
    script: [],
  };
}

function compileSpriteObject(
  obj: EntryIRObject,
  sceneId: string,
  template: Record<string, unknown>,
  ctx: CompileContext,
  nextId: () => string,
): Record<string, unknown> {
  const base = structuredClone(template) as Record<string, unknown>;
  base.id = nextId();
  base.name = obj.name;
  base.label = { ko: obj.name, en: obj.name };
  base.objectType = 'sprite';
  base.scene = sceneId;

  const sprite = base.sprite as SkeletonSprite;
  const useCustom = obj.sprite === 'custom' || (obj.pictures && obj.pictures.length > 0);

  if (useCustom && obj.pictures && obj.pictures.length > 0) {
    sprite.pictures = obj.pictures.map((pic) => buildHostPicture(pic, nextId));
    const first = sprite.pictures[0];
    const dim = first.dimension as { width: number; height: number };
    const entity = base.entity as Record<string, number>;
    entity.width = dim.width;
    entity.height = dim.height;
    entity.regX = dim.width / 2;
    entity.regY = dim.height / 2;
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

  const entity = base.entity as Record<string, number>;
  if (typeof obj.x === 'number') entity.x = obj.x;
  if (typeof obj.y === 'number') entity.y = obj.y;

  const scripts = obj.scripts.map((thread, ti) =>
    compileTopThread(thread, ctx, THREAD_X + ti * 300, THREAD_Y_START + ti * THREAD_Y_GAP),
  );
  base.script = scripts;
  return base;
}

function compileTextObject(
  obj: EntryIRObject,
  sceneId: string,
  ctx: CompileContext,
  nextId: () => string,
): Record<string, unknown> {
  const scripts =
    obj.scripts.length > 0
      ? obj.scripts.map((thread, ti) =>
          compileTopThread(thread, ctx, THREAD_X + ti * 300, THREAD_Y_START + ti * THREAD_Y_GAP),
        )
      : [];

  return {
    id: nextId(),
    name: obj.name,
    label: { ko: obj.name, en: obj.name },
    objectType: 'textBox',
    text: obj.text ?? '',
    scene: sceneId,
    lock: false,
    active: true,
    rotateMethod: 'free',
    entity: {
      x: typeof obj.x === 'number' ? obj.x : 0,
      y: typeof obj.y === 'number' ? obj.y : 0,
      rotation: 0,
      direction: 90,
      regX: 0,
      regY: 0,
      scaleX: 1,
      scaleY: 1,
      width: 240,
      height: 48,
      visible: true,
      colour: '#000000',
      font: '16px Nanum Gothic',
      bgColor: 'transparent',
      textAlign: 0,
      lineBreak: true,
      underLine: false,
      strike: false,
      text: obj.text ?? '',
    },
    script: scripts,
  };
}

export function compileProject(ir: EntryIR, options: CompileOptions = {}): EntryProject {
  const catalog = options.catalog ?? loadCatalog();
  const strict = options.strict !== false;

  const validation = validateProject(ir, catalog);
  if (!validation.valid && strict) {
    throw new CompileError(validation.errors, validation.hints);
  }

  const index = catalogIndex(catalog);
  const project = createStartProjectSkeleton();
  project.name = ir.objects[0]?.name ? `${ir.objects[0].name} 프로젝트` : '엔트리 프로젝트';
  if (typeof ir.speed === 'number' && ir.speed > 0) {
    project.speed = ir.speed;
  }
  if (ir.learning) {
    project.learning = compileLearning(ir.learning);
  }

  const irScenes = resolveScenes(ir);
  const defaultSceneName = irScenes[0].name;
  const sceneNameToId = new Map<string, string>();
  const nextId = createIdFactory([...project.variables.map((v) => String(v.id))]);

  project.scenes = irScenes.map((scene) => {
    const id = nextId();
    sceneNameToId.set(scene.name, id);
    return { id, name: scene.name };
  });

  const sceneIdFor = (name?: string): string => {
    const key = name ?? defaultSceneName;
    const id = sceneNameToId.get(key);
    if (!id) {
      throw new CompileError([`unknown scene ${JSON.stringify(key)}`]);
    }
    return id;
  };

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

  const messageIds = new Map<string, string>();
  project.messages = [];
  for (const m of ir.messages ?? []) {
    const id = nextId();
    messageIds.set(m.name, id);
    project.messages.push({ id, name: m.name });
  }

  const functionIds = new Map<string, string>();
  for (const fn of ir.functions ?? []) {
    functionIds.set(fn.name, nextId());
  }

  const ctx: CompileContext = { index, variableIds, listIds, messageIds, functionIds };

  project.functions = (ir.functions ?? []).map((fn) => {
    const id = functionIds.get(fn.name)!;
    return compileFunctionDef(fn, id, ctx);
  });

  const template = project.objects[0];
  const compiledObjects: Record<string, unknown>[] = [];

  for (const scene of irScenes) {
    const sceneId = sceneIdFor(scene.name);
    if (scene.background) {
      compiledObjects.push(compileBackgroundObject(sceneId, scene.background, nextId));
    }
  }

  for (const obj of ir.objects) {
    const sceneId = sceneIdFor(obj.scene);
    if (obj.kind === 'text') {
      compiledObjects.push(compileTextObject(obj, sceneId, ctx, nextId));
    } else {
      compiledObjects.push(compileSpriteObject(obj, sceneId, template, ctx, nextId));
    }
  }

  project.objects = compiledObjects;

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
