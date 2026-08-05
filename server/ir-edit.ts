/**
 * Incremental IR edits for stateless MCP host workflows.
 */
import type {
  EntryIR,
  EntryIRLearning,
  EntryIRList,
  EntryIRMessage,
  EntryIRObject,
  EntryIRScene,
  EntryIRVariable,
  IRBlock,
  Thread,
} from '../src/types/ir.ts';
import { validateProject } from '../compiler/validate.ts';

export class IREditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IREditError';
  }
}

function cloneIR(ir: EntryIR): EntryIR {
  return structuredClone(ir);
}

function defaultScenes(ir: EntryIR): EntryIRScene[] {
  return ir.scenes && ir.scenes.length > 0 ? ir.scenes : [{ name: '장면 1' }];
}

/** Append an object to ir.objects (returns new IR). */
export function addObject(ir: EntryIR, object: EntryIRObject): EntryIR {
  if (!object?.name) {
    throw new IREditError('object.name is required');
  }
  const next = cloneIR(ir);
  if (next.objects.some((o) => o.name === object.name)) {
    throw new IREditError(`object name already exists: ${JSON.stringify(object.name)}`);
  }
  next.objects.push(structuredClone(object));
  return next;
}

export function removeObject(ir: EntryIR, objectName: string): EntryIR {
  const next = cloneIR(ir);
  const idx = next.objects.findIndex((o) => o.name === objectName);
  if (idx < 0) {
    throw new IREditError(`object not found: ${JSON.stringify(objectName)}`);
  }
  if (next.objects.length <= 1) {
    throw new IREditError('cannot remove the last object — IR must keep at least one');
  }
  next.objects.splice(idx, 1);
  return next;
}

export function patchObject(
  ir: EntryIR,
  objectName: string,
  patch: Partial<Omit<EntryIRObject, 'name'>>,
): EntryIR {
  const next = cloneIR(ir);
  const obj = next.objects.find((o) => o.name === objectName);
  if (!obj) {
    throw new IREditError(`object not found: ${JSON.stringify(objectName)}`);
  }
  Object.assign(obj, structuredClone(patch));
  return next;
}

export function addScene(ir: EntryIR, scene: EntryIRScene): EntryIR {
  if (!scene?.name) throw new IREditError('scene.name is required');
  const next = cloneIR(ir);
  next.scenes = defaultScenes(next);
  if (next.scenes.some((s) => s.name === scene.name)) {
    throw new IREditError(`scene already exists: ${JSON.stringify(scene.name)}`);
  }
  next.scenes.push(structuredClone(scene));
  return next;
}

export function removeScene(ir: EntryIR, sceneName: string): EntryIR {
  const next = cloneIR(ir);
  next.scenes = defaultScenes(next);
  if (next.scenes.length <= 1) {
    throw new IREditError('cannot remove the last scene');
  }
  const idx = next.scenes.findIndex((s) => s.name === sceneName);
  if (idx < 0) {
    throw new IREditError(`scene not found: ${JSON.stringify(sceneName)}`);
  }
  const used = next.objects.some((o) => o.scene === sceneName);
  if (used) {
    throw new IREditError(
      `scene ${JSON.stringify(sceneName)} is still referenced by objects — reassign objects first`,
    );
  }
  next.scenes.splice(idx, 1);
  return next;
}

export function addVariable(ir: EntryIR, variable: EntryIRVariable): EntryIR {
  const next = cloneIR(ir);
  next.variables = next.variables ?? [];
  if (next.variables.some((v) => v.name === variable.name)) {
    throw new IREditError(`variable already exists: ${JSON.stringify(variable.name)}`);
  }
  next.variables.push(structuredClone(variable));
  return next;
}

export function removeVariable(ir: EntryIR, name: string): EntryIR {
  const next = cloneIR(ir);
  if (!next.variables?.length) {
    throw new IREditError(`variable not found: ${JSON.stringify(name)}`);
  }
  const idx = next.variables.findIndex((v) => v.name === name);
  if (idx < 0) throw new IREditError(`variable not found: ${JSON.stringify(name)}`);
  next.variables.splice(idx, 1);
  if (next.variables.length === 0) delete next.variables;
  return next;
}

export function addList(ir: EntryIR, list: EntryIRList): EntryIR {
  const next = cloneIR(ir);
  next.lists = next.lists ?? [];
  if (next.lists.some((l) => l.name === list.name)) {
    throw new IREditError(`list already exists: ${JSON.stringify(list.name)}`);
  }
  next.lists.push(structuredClone(list));
  return next;
}

export function removeList(ir: EntryIR, name: string): EntryIR {
  const next = cloneIR(ir);
  if (!next.lists?.length) throw new IREditError(`list not found: ${JSON.stringify(name)}`);
  const idx = next.lists.findIndex((l) => l.name === name);
  if (idx < 0) throw new IREditError(`list not found: ${JSON.stringify(name)}`);
  next.lists.splice(idx, 1);
  if (next.lists.length === 0) delete next.lists;
  return next;
}

export function addMessage(ir: EntryIR, message: EntryIRMessage): EntryIR {
  const next = cloneIR(ir);
  next.messages = next.messages ?? [];
  if (next.messages.some((m) => m.name === message.name)) {
    throw new IREditError(`message already exists: ${JSON.stringify(message.name)}`);
  }
  next.messages.push(structuredClone(message));
  return next;
}

export function removeMessage(ir: EntryIR, name: string): EntryIR {
  const next = cloneIR(ir);
  if (!next.messages?.length) throw new IREditError(`message not found: ${JSON.stringify(name)}`);
  const idx = next.messages.findIndex((m) => m.name === name);
  if (idx < 0) throw new IREditError(`message not found: ${JSON.stringify(name)}`);
  next.messages.splice(idx, 1);
  if (next.messages.length === 0) delete next.messages;
  return next;
}

export function setLearning(ir: EntryIR, learning: EntryIRLearning | null): EntryIR {
  const next = cloneIR(ir);
  if (learning === null) {
    delete next.learning;
  } else {
    next.learning = structuredClone(learning);
  }
  return next;
}

export type PatchScriptMode = 'replace' | 'append' | 'prepend';

export interface PatchScriptOptions {
  objectName: string;
  threadIndex: number;
  mode: PatchScriptMode;
  thread?: Thread;
  blocks?: IRBlock[];
}

/** Patch one script thread on a named object (returns new IR). */
export function patchScript(ir: EntryIR, options: PatchScriptOptions): EntryIR {
  const { objectName, threadIndex, mode } = options;
  const next = cloneIR(ir);
  const obj = next.objects.find((o) => o.name === objectName);
  if (!obj) {
    throw new IREditError(`object not found: ${JSON.stringify(objectName)}`);
  }
  if (!Array.isArray(obj.scripts)) {
    throw new IREditError(`object "${objectName}" has no scripts array`);
  }
  if (threadIndex < 0 || threadIndex >= obj.scripts.length) {
    throw new IREditError(
      `threadIndex ${threadIndex} out of range (object has ${obj.scripts.length} thread(s))`,
    );
  }

  if (mode === 'replace') {
    if (!options.thread || !Array.isArray(options.thread)) {
      throw new IREditError('mode=replace requires thread: IRBlock[]');
    }
    obj.scripts[threadIndex] = structuredClone(options.thread);
  } else if (mode === 'append') {
    if (!options.blocks?.length) {
      throw new IREditError('mode=append requires non-empty blocks: IRBlock[]');
    }
    obj.scripts[threadIndex] = [...obj.scripts[threadIndex], ...structuredClone(options.blocks)];
  } else if (mode === 'prepend') {
    if (!options.blocks?.length) {
      throw new IREditError('mode=prepend requires non-empty blocks: IRBlock[]');
    }
    obj.scripts[threadIndex] = [...structuredClone(options.blocks), ...obj.scripts[threadIndex]];
  } else {
    throw new IREditError(`unknown mode: ${String(mode)}`);
  }

  return next;
}

function withValidation(ir: EntryIR): { ir: EntryIR; validation: ReturnType<typeof validateProject> } {
  return { ir, validation: validateProject(ir) };
}

export function addObjectValidated(ir: EntryIR, object: EntryIRObject) {
  return withValidation(addObject(ir, object));
}

export function patchScriptValidated(ir: EntryIR, options: PatchScriptOptions) {
  return withValidation(patchScript(ir, options));
}

export function removeObjectValidated(ir: EntryIR, objectName: string) {
  return withValidation(removeObject(ir, objectName));
}

export function patchObjectValidated(
  ir: EntryIR,
  objectName: string,
  patch: Partial<Omit<EntryIRObject, 'name'>>,
) {
  return withValidation(patchObject(ir, objectName, patch));
}

export function addSceneValidated(ir: EntryIR, scene: EntryIRScene) {
  return withValidation(addScene(ir, scene));
}

export function removeSceneValidated(ir: EntryIR, sceneName: string) {
  return withValidation(removeScene(ir, sceneName));
}

export function setLearningValidated(ir: EntryIR, learning: EntryIRLearning | null) {
  return withValidation(setLearning(ir, learning));
}
