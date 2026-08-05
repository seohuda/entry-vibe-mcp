/**
 * Incremental IR edits for stateless MCP host workflows.
 */
import type { EntryIR, EntryIRObject, IRBlock, Thread } from '../src/types/ir.ts';
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

/** Append an object to ir.objects (returns new IR). */
export function addObject(ir: EntryIR, object: EntryIRObject): EntryIR {
  if (!object?.name) {
    throw new IREditError('object.name is required');
  }
  const next = cloneIR(ir);
  const dup = next.objects.some((o) => o.name === object.name);
  if (dup) {
    throw new IREditError(`object name already exists: ${JSON.stringify(object.name)}`);
  }
  next.objects.push(structuredClone(object));
  return next;
}

export type PatchScriptMode = 'replace' | 'append' | 'prepend';

export interface PatchScriptOptions {
  objectName: string;
  threadIndex: number;
  mode: PatchScriptMode;
  /** Full thread replacement when mode=replace. */
  thread?: Thread;
  /** Blocks to append/prepend when mode=append|prepend. */
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

/** addObject + validate in one step for MCP tools. */
export function addObjectValidated(
  ir: EntryIR,
  object: EntryIRObject,
): { ir: EntryIR; validation: ReturnType<typeof validateProject> } {
  const next = addObject(ir, object);
  const validation = validateProject(next);
  return { ir: next, validation };
}

/** patchScript + validate in one step for MCP tools. */
export function patchScriptValidated(
  ir: EntryIR,
  options: PatchScriptOptions,
): { ir: EntryIR; validation: ReturnType<typeof validateProject> } {
  const next = patchScript(ir, options);
  const validation = validateProject(next);
  return { ir: next, validation };
}
