/**
 * Decompile Entry project.json → EntryIR (best-effort round-trip).
 */
import type { BlockCatalog, BlockParamSchema, BlockSchema } from '../src/types/block.ts';
import type {
  EntryIR,
  EntryIRFunction,
  EntryIRObject,
  EntryIRScene,
  IRBlock,
  IRParamValue,
  Thread,
} from '../src/types/ir.ts';
import type { EntryProject } from './skeleton.ts';
import {
  catalogIndex,
  FUNCTION_CALL_TYPE,
  LIST_PARAM_KEY,
  loadCatalog,
  MESSAGE_PARAM_KEY,
  MESSAGE_BLOCK_TYPES,
  VARIABLE_PARAM_KEY,
} from './validate.ts';
import { parseHostAssetMarker } from './assets.ts';
import { decompileLearning } from './learning.ts';
import type { UnpackedMedia } from './unpack.ts';
import { mediaPathByFileId } from './unpack.ts';
import { getLibraryAttributions } from './library-media.ts';

export interface DecompileResult {
  ir: EntryIR;
  warnings: string[];
}

const ENTRYBOT_PICTURE_NAMES = new Set(['엔트리봇_걷기1', '엔트리봇_걷기2']);
const ENTRYBOT_SOUND_NAMES = new Set(['강아지 짖는 소리', '강아지 짖는소리']);
const BACKGROUND_NAMES = new Set(['배경', 'Background', 'background']);

function parseScript(raw: unknown): unknown[][] {
  if (typeof raw === 'string') {
    return JSON.parse(raw) as unknown[][];
  }
  if (Array.isArray(raw)) return raw as unknown[][];
  return [];
}

function isCompiledBlock(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && typeof (v as { type?: unknown }).type === 'string';
}

function decompilePrimitive(block: Record<string, unknown>): IRParamValue | undefined {
  const type = block.type as string;
  const params = block.params as unknown[] | undefined;
  if (type === 'number' && params?.[0] !== undefined) return Number(params[0]);
  if (type === 'text' && params?.[0] !== undefined) return String(params[0]);
  if (type === 'True') return true;
  if (type === 'False') return false;
  return undefined;
}

interface DecompileCtx {
  index: Map<string, BlockSchema>;
  variableIdToName: Map<string, string>;
  listIdToName: Map<string, string>;
  messageIdToName: Map<string, string>;
  functionIdToName: Map<string, string>;
  mediaByFileId: Map<string, string>;
  warnings: string[];
  sceneBackgroundIds: Set<string>;
}

function decompileParamValue(
  value: unknown,
  param: BlockParamSchema,
  ctx: DecompileCtx,
  parentType?: string,
): IRParamValue | undefined {
  if (value === null || value === undefined) return undefined;

  if (isCompiledBlock(value)) {
    const innerType = value.type as string;
    if (innerType === 'number' || innerType === 'text' || innerType === 'True' || innerType === 'False') {
      return decompilePrimitive(value);
    }
    return decompileBlock(value, ctx);
  }

  if (param.key === VARIABLE_PARAM_KEY && typeof value === 'string') {
    return ctx.variableIdToName.get(value) ?? value;
  }
  if (param.key === LIST_PARAM_KEY && typeof value === 'string') {
    return ctx.listIdToName.get(value) ?? value;
  }
  if (
    parentType &&
    MESSAGE_BLOCK_TYPES.has(parentType) &&
    param.key === MESSAGE_PARAM_KEY &&
    typeof value === 'string'
  ) {
    return ctx.messageIdToName.get(value) ?? value;
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return undefined;
}

function decompileBlock(block: Record<string, unknown>, ctx: DecompileCtx): IRBlock {
  const type = block.type as string;

  if (type.startsWith('func_')) {
    const id = type.slice(5);
    const name = ctx.functionIdToName.get(id);
    if (!name) {
      ctx.warnings.push(`unknown function block ${type} — using id as NAME`);
    }
    return { type: FUNCTION_CALL_TYPE, params: { NAME: name ?? id } };
  }

  const schema = ctx.index.get(type);
  const out: IRBlock = { type };

  if (schema && Array.isArray(block.params)) {
    const paramsArr = block.params as unknown[];
    const params: Record<string, IRParamValue> = {};
    schema.params.forEach((param, i) => {
      if (param.type === 'Indicator' || param.type === 'LineBreak') return;
      const val = decompileParamValue(paramsArr[i], param, ctx, type);
      if (val !== undefined) {
        params[param.key] = val;
      }
    });
    if (Object.keys(params).length > 0) out.params = params;
  }

  if (schema && Array.isArray(block.statements)) {
    const statementsArr = block.statements as unknown[][];
    const statements: Record<string, Thread> = {};
    for (let i = 0; i < schema.statementSlots; i++) {
      const key = schema.statementKeys[i] ?? String(i);
      const thread = statementsArr[i];
      if (Array.isArray(thread) && thread.length > 0) {
        statements[key] = decompileThread(thread, ctx);
      }
    }
    if (Object.keys(statements).length > 0) out.statements = statements;
  } else if (!schema) {
    ctx.warnings.push(`decompiled unknown block type "${type}" without schema`);
  }

  return out;
}

function decompileThread(thread: unknown[], ctx: DecompileCtx): Thread {
  const out: Thread = [];
  for (const item of thread) {
    if (isCompiledBlock(item)) out.push(decompileBlock(item, ctx));
  }
  return out;
}

function buildIdMaps(project: EntryProject): {
  variableIdToName: Map<string, string>;
  listIdToName: Map<string, string>;
} {
  const variableIdToName = new Map<string, string>();
  const listIdToName = new Map<string, string>();
  for (const v of project.variables ?? []) {
    const id = String(v.id);
    const name = String(v.name);
    if (v.variableType === 'list') listIdToName.set(id, name);
    else if (v.variableType === 'variable') variableIdToName.set(id, name);
  }
  return { variableIdToName, listIdToName };
}

function buildMessageMap(project: EntryProject): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of project.messages ?? []) {
    map.set(m.id, m.name);
  }
  return map;
}

function buildFunctionMap(project: EntryProject): Map<string, string> {
  const map = new Map<string, string>();
  for (const fn of project.functions ?? []) {
    const rec = fn as { id?: string; content?: string };
    if (!rec.id || !rec.content) continue;
    try {
      const content = JSON.parse(rec.content) as unknown[][][];
      const hatRaw = content?.[0]?.[0];
      if (!isCompiledBlock(hatRaw)) continue;
      const hat = hatRaw;
      const field = (hat?.params as unknown[])?.[0] as { params?: unknown[] } | undefined;
      const name = field?.params?.[0];
      if (typeof name === 'string') map.set(rec.id, name);
    } catch {
      // skip malformed
    }
  }
  return map;
}

function decompileFunctions(
  project: EntryProject,
  ctx: DecompileCtx,
): EntryIRFunction[] {
  const out: EntryIRFunction[] = [];
  for (const fn of project.functions ?? []) {
    const rec = fn as { id?: string; content?: string; type?: string };
    if (!rec.content) continue;
    let content: unknown[][][];
    try {
      content = JSON.parse(rec.content) as unknown[][][];
    } catch {
      ctx.warnings.push(`skipped malformed function ${rec.id}`);
      continue;
    }
    const hatRaw = content?.[0]?.[0];
    if (!isCompiledBlock(hatRaw)) continue;
    const hat = hatRaw;
    const field = (hat.params as unknown[])?.[0] as { params?: unknown[] } | undefined;
    const name = field?.params?.[0];
    if (typeof name !== 'string') continue;

    const bodyThread = ((hat.statements as unknown[][])?.[0] ?? []) as unknown[];
    const irFn: EntryIRFunction = {
      name,
      type: hat.type === 'function_create_value' ? 'string' : 'statement',
      body: decompileThread(bodyThread, ctx),
    };
    if (hat.type === 'function_create_value') {
      const ret = (hat.params as unknown[])?.[3];
      if (isCompiledBlock(ret as object)) {
        const prim = decompilePrimitive(ret as Record<string, unknown>);
        if (prim !== undefined) irFn.returnValue = prim;
        else irFn.returnValue = decompileBlock(ret as Record<string, unknown>, ctx);
      }
    }
    out.push(irFn);
  }
  return out;
}

function pictureAssetPath(
  pic: Record<string, unknown>,
  ctx: DecompileCtx,
): string | undefined {
  const host = parseHostAssetMarker(String(pic.fileurl ?? ''));
  if (host) return `assets/${host}`;
  const filename = String(pic.filename ?? '');
  if (filename && ctx.mediaByFileId.has(filename)) {
    return ctx.mediaByFileId.get(filename);
  }
  return undefined;
}

function isEntrybotSprite(
  pictures: Array<Record<string, unknown>>,
  sounds: Array<Record<string, unknown>>,
): boolean {
  if (pictures.length === 0) return true;
  const picNames = pictures.map((p) => String(p.name ?? ''));
  if (picNames.every((n) => ENTRYBOT_PICTURE_NAMES.has(n) || n.includes('엔트리봇'))) {
    if (sounds.length === 0) return true;
    return sounds.every((s) => ENTRYBOT_SOUND_NAMES.has(String(s.name ?? '')));
  }
  return false;
}

function isBackgroundObject(obj: Record<string, unknown>, scripts: unknown[][]): boolean {
  if (obj.objectType !== 'sprite') return false;
  if (obj.lock !== true) return false;
  const name = String(obj.name ?? '');
  if (BACKGROUND_NAMES.has(name) || name.startsWith('배경')) return true;
  // Backgrounds may animate or respond to events; locking/rotation identify the
  // layer independently of its display name and scripts.
  return obj.rotateMethod === 'none';
}

function decompileObject(
  obj: Record<string, unknown>,
  sceneIdToName: Map<string, string>,
  ctx: DecompileCtx,
): EntryIRObject | null {
  const entity = (obj.entity ?? {}) as Record<string, unknown>;
  const objectType = String(obj.objectType ?? 'sprite');
  const scripts = parseScript(obj.script).map((t) => decompileThread(t, ctx));

  if (ctx.sceneBackgroundIds.has(String(obj.id))) {
    return null;
  }

  const base: EntryIRObject = {
    name: String(obj.name ?? 'object'),
    scripts,
  };
  if (isBackgroundObject(obj, parseScript(obj.script))) base.background = true;

  if (typeof entity.x === 'number') base.x = entity.x;
  if (typeof entity.y === 'number') base.y = entity.y;

  const sceneId = String(obj.scene ?? '');
  const sceneName = sceneIdToName.get(sceneId);
  if (sceneName) base.scene = sceneName;

  if (objectType === 'textBox') {
    base.kind = 'text';
    base.text = String(entity.text ?? obj.text ?? '');
    return base;
  }

  const sprite = (obj.sprite ?? {}) as { pictures?: unknown[]; sounds?: unknown[] };
  const pictures = (sprite.pictures ?? []) as Array<Record<string, unknown>>;
  const sounds = (sprite.sounds ?? []) as Array<Record<string, unknown>>;

  if (isEntrybotSprite(pictures, sounds)) {
    base.sprite = 'entrybot';
  } else {
    base.sprite = 'custom';
    const irPictures = pictures
      .map((pic) => {
        const path = pictureAssetPath(pic, ctx);
        if (!path) {
          ctx.warnings.push(`object "${base.name}": picture ${pic.name} media not extracted`);
          return null;
        }
        return { name: String(pic.name ?? ''), path };
      })
      .filter((p): p is { name: string; path: string } => Boolean(p));
    if (irPictures.length > 0) base.pictures = irPictures;

    const irSounds = sounds
      .map((snd) => {
        const host = parseHostAssetMarker(String(snd.fileurl ?? ''));
        let path: string | undefined;
        if (host) path = `assets/${host}`;
        else {
          const filename = String(snd.filename ?? '');
          path = ctx.mediaByFileId.get(filename);
        }
        if (!path) {
          ctx.warnings.push(`object "${base.name}": sound ${snd.name} media not extracted`);
          return null;
        }
        return {
          name: String(snd.name ?? ''),
          path,
          duration: typeof snd.duration === 'number' ? snd.duration : undefined,
        };
      })
      .filter((s): s is NonNullable<typeof s> => Boolean(s));
    // Explicit empty sounds prevent custom/library imports inheriting Entrybot's bark.
    base.sounds = irSounds;
  }

  return base;
}

function decompileSceneBackgrounds(
  project: EntryProject,
  sceneIdToName: Map<string, string>,
  ctx: DecompileCtx,
): Map<string, EntryIRScene['background']> {
  const backgrounds = new Map<string, EntryIRScene['background']>();
  // A background-only project still needs an object in IR; retain its layers below.
  if (!project.objects.some((obj) => !isBackgroundObject(obj, parseScript(obj.script)))) return backgrounds;
  for (const obj of project.objects ?? []) {
    const rec = obj as Record<string, unknown>;
    const scripts = parseScript(rec.script);
    if (!isBackgroundObject(rec, scripts)) continue;
    const sceneId = String(rec.scene ?? '');
    const sceneName = sceneIdToName.get(sceneId);
    if (!sceneName) continue;
    if (backgrounds.has(sceneName)) continue;
    const sprite = (rec.sprite ?? {}) as { pictures?: unknown[]; sounds?: unknown[] };
    // Scene.background can express one static picture. Keep richer layers as objects.
    if (sprite.pictures?.length !== 1 || sprite.sounds?.length || scripts.flat().length) continue;
    const pic = (sprite.pictures ?? [])[0] as Record<string, unknown> | undefined;
    if (!pic) continue;
    const dimension = pic.dimension as { width?: number; height?: number } | undefined;
    const entity = rec.entity as { scaleX?: number; scaleY?: number } | undefined;
    const legacyScale = Math.max(960 / Number(dimension?.width), 540 / Number(dimension?.height));
    // Legacy scene.background fits 960×540; new library/background objects fit
    // Entry's logical 480×270. Keep the latter as explicit background objects so
    // a roundtrip does not accidentally double their scale.
    if (!Number.isFinite(legacyScale) || !Number.isFinite(entity?.scaleX) || !Number.isFinite(entity?.scaleY) ||
        Math.abs(Number(entity?.scaleX) - legacyScale) > 1e-9 ||
        Math.abs(Number(entity?.scaleY) - legacyScale) > 1e-9) continue;
    const path = pictureAssetPath(pic, ctx);
    if (!path) {
      ctx.warnings.push(`scene "${sceneName}": background media not extracted`);
      continue;
    }
    backgrounds.set(sceneName, {
      name: String(pic.name ?? rec.name ?? '배경'),
      path,
    });
    ctx.sceneBackgroundIds.add(String(rec.id));
  }
  return backgrounds;
}

export function decompileProject(
  project: EntryProject,
  options: {
    catalog?: BlockCatalog;
    media?: UnpackedMedia[];
  } = {},
): DecompileResult {
  const catalog = options.catalog ?? loadCatalog();
  const warnings: string[] = [];
  const { variableIdToName, listIdToName } = buildIdMaps(project);
  const messageIdToName = buildMessageMap(project);
  const functionIdToName = buildFunctionMap(project);
  const mediaByFileId = mediaPathByFileId(options.media ?? []);

  const ctx: DecompileCtx = {
    index: catalogIndex(catalog),
    variableIdToName,
    listIdToName,
    messageIdToName,
    functionIdToName,
    mediaByFileId,
    warnings,
    sceneBackgroundIds: new Set(),
  };

  const sceneIdToName = new Map<string, string>();
  for (const s of project.scenes ?? []) {
    sceneIdToName.set(s.id, s.name);
  }
  const sceneBackgrounds = decompileSceneBackgrounds(project, sceneIdToName, ctx);

  const scenes: EntryIRScene[] = (project.scenes ?? []).map((s) => {
    const bg = sceneBackgrounds.get(s.name);
    return bg ? { name: s.name, background: bg } : { name: s.name };
  });

  const ir: EntryIR = {
    ...(getLibraryAttributions(project).length ? { assetAttributions: getLibraryAttributions(project) } : {}),
    scenes: scenes.length > 0 ? scenes : undefined,
    speed: typeof project.speed === 'number' ? project.speed : undefined,
    learning: decompileLearning((project as { learning?: unknown }).learning),
    variables: [...variableIdToName.entries()].map(([id, name]) => {
      const v = project.variables?.find((x) => x.id === id);
      return { name, initialValue: String(v?.value ?? '0') };
    }),
    lists: [...listIdToName.entries()].map(([id, name]) => {
      const v = project.variables?.find((x) => x.id === id) as
        | { array?: Array<{ data: string }> }
        | undefined;
      return {
        name,
        initialValues: (v?.array ?? []).map((a) => a.data),
      };
    }),
    messages: (project.messages ?? []).map((m) => ({ name: m.name })),
    functions: decompileFunctions(project, ctx),
    objects: (project.objects ?? [])
      .map((o) => decompileObject(o as Record<string, unknown>, sceneIdToName, ctx))
      .filter((o): o is EntryIRObject => o !== null),
  };

  if (ir.variables?.length === 0) delete ir.variables;
  if (ir.lists?.length === 0) delete ir.lists;
  if (ir.messages?.length === 0) delete ir.messages;
  if (ir.functions?.length === 0) delete ir.functions;
  if (!ir.learning) delete ir.learning;
  if (ir.speed === undefined) delete ir.speed;

  return { ir, warnings: [...warnings, ...ctx.warnings] };
}
