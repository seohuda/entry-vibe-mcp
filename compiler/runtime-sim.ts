/**
 * Lightweight deterministic simulator for core Entry blocks.
 * Approximates entity motion / variables after the run button — not full entryjs.
 */
import type { EntryIR, IRBlock, IRParamValue, Thread } from '../src/types/ir.ts';
import { catalogIndex, loadCatalog } from './validate.ts';

export interface SimObjectState {
  name: string;
  x: number;
  y: number;
  direction: number;
}

export interface SimulateOptions {
  /** Max bytecode steps (default 500). */
  maxSteps?: number;
  /** Max repeat_inf iterations per loop (default 100). */
  maxLoopIterations?: number;
}

export interface SimulateResult {
  ok: boolean;
  stepsExecuted: number;
  truncated: boolean;
  objects: SimObjectState[];
  variables: Record<string, number | string | boolean>;
  warnings: string[];
}

interface SimContext {
  objects: Map<string, SimObjectState>;
  variables: Map<string, number | string | boolean>;
  lists: Map<string, Array<string | number>>;
  maxSteps: number;
  maxLoopIterations: number;
  steps: number;
  truncated: boolean;
  warnings: string[];
}

const STAGE_HALF_W = 480;
const STAGE_HALF_H = 270;

function isIRBlock(v: IRParamValue): v is IRBlock {
  return typeof v === 'object' && v !== null && 'type' in v;
}

function num(v: IRParamValue | undefined, fallback = 0): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  return fallback;
}

function str(v: IRParamValue | undefined, fallback = ''): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return fallback;
}

function rad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function runThread(thread: Thread, ctx: SimContext, objectName: string): void {
  for (const block of thread) {
    if (ctx.steps >= ctx.maxSteps) {
      ctx.truncated = true;
      return;
    }
    runBlock(block, ctx, objectName);
    if (ctx.truncated) return;
  }
}

function runBlock(block: IRBlock, ctx: SimContext, objectName: string): void {
  if (ctx.steps >= ctx.maxSteps) {
    ctx.truncated = true;
    return;
  }
  ctx.steps++;

  const obj = ctx.objects.get(objectName);
  if (!obj) return;

  switch (block.type) {
    case 'when_run_button_click':
    case 'when_message_cast':
      return;
    case 'move_direction': {
      const steps = num(block.params?.VALUE, 10);
      const dx = Math.cos(rad(obj.direction - 90)) * steps;
      const dy = Math.sin(rad(obj.direction - 90)) * steps;
      obj.x += dx;
      obj.y += dy;
      return;
    }
    case 'rotate_relative':
      obj.direction = (obj.direction + num(block.params?.VALUE, 0)) % 360;
      return;
    case 'rotate_absolute':
      obj.direction = num(block.params?.VALUE, obj.direction) % 360;
      return;
    case 'bounce_wall': {
      if (obj.x > STAGE_HALF_W || obj.x < -STAGE_HALF_W) {
        obj.direction = (180 - obj.direction + 360) % 360;
        obj.x = Math.max(-STAGE_HALF_W, Math.min(STAGE_HALF_W, obj.x));
      }
      if (obj.y > STAGE_HALF_H || obj.y < -STAGE_HALF_H) {
        obj.direction = (360 - obj.direction) % 360;
        obj.y = Math.max(-STAGE_HALF_H, Math.min(STAGE_HALF_H, obj.y));
      }
      return;
    }
    case 'set_variable': {
      const name = str(block.params?.VARIABLE);
      if (!name) return;
      ctx.variables.set(name, resolveValue(block.params?.VALUE, ctx));
      return;
    }
    case 'change_variable': {
      const name = str(block.params?.VARIABLE);
      if (!name) return;
      const prev = Number(ctx.variables.get(name) ?? 0);
      ctx.variables.set(name, prev + num(block.params?.VALUE, 1));
      return;
    }
    case 'repeat_basic': {
      const count = Math.min(Math.max(0, Math.floor(num(block.params?.VALUE, 0))), ctx.maxLoopIterations);
      const body = block.statements?.DO ?? [];
      for (let i = 0; i < count; i++) {
        runThread(body, ctx, objectName);
        if (ctx.truncated) return;
      }
      return;
    }
    case 'repeat_inf': {
      const body = block.statements?.DO ?? [];
      for (let i = 0; i < ctx.maxLoopIterations; i++) {
        runThread(body, ctx, objectName);
        if (ctx.truncated) return;
      }
      ctx.warnings.push(`repeat_inf on "${objectName}" capped at ${ctx.maxLoopIterations} iterations`);
      return;
    }
    case 'function_call':
      ctx.warnings.push(`function_call not simulated (skipped)`);
      return;
    default:
      if (block.type.startsWith('get_') || block.type.startsWith('is_')) return;
      ctx.warnings.push(`block "${block.type}" not simulated (skipped)`);
  }
}

function resolveValue(
  value: IRParamValue | undefined,
  ctx: SimContext,
): number | string | boolean {
  if (value === undefined) return 0;
  if (!isIRBlock(value)) return value;
  if (value.type === 'number') return num(value.params?.VALUE);
  if (value.type === 'text') return str(value.params?.VALUE);
  if (value.type === 'True') return true;
  if (value.type === 'False') return false;
  return 0;
}

export function simulateProject(ir: EntryIR, options: SimulateOptions = {}): SimulateResult {
  const maxSteps = options.maxSteps ?? 500;
  const maxLoopIterations = options.maxLoopIterations ?? 100;
  const warnings: string[] = [];
  const index = catalogIndex(loadCatalog());

  const objects = new Map<string, SimObjectState>();
  for (const obj of ir.objects) {
    if ((obj.kind ?? 'sprite') === 'text') continue;
    objects.set(obj.name, {
      name: obj.name,
      x: typeof obj.x === 'number' ? obj.x : 0,
      y: typeof obj.y === 'number' ? obj.y : 0,
      direction: 90,
    });
  }

  const variables = new Map<string, number | string | boolean>();
  for (const v of ir.variables ?? []) {
    variables.set(v.name, v.initialValue);
  }
  const lists = new Map<string, Array<string | number>>();
  for (const l of ir.lists ?? []) {
    lists.set(l.name, [...(l.initialValues ?? [])]);
  }

  const ctx: SimContext = {
    objects,
    variables,
    lists,
    maxSteps,
    maxLoopIterations,
    steps: 0,
    truncated: false,
    warnings,
  };

  for (const obj of ir.objects) {
    if ((obj.kind ?? 'sprite') === 'text') continue;
    for (const thread of obj.scripts) {
      if (thread.length === 0) continue;
      const hat = index.get(thread[0].type);
      if (!hat?.isHat) {
        warnings.push(`object "${obj.name}": first block is not an event hat — skipped thread`);
        continue;
      }
      runThread(thread.slice(1), ctx, obj.name);
      if (ctx.truncated) break;
    }
    if (ctx.truncated) break;
  }

  return {
    ok: true,
    stepsExecuted: ctx.steps,
    truncated: ctx.truncated,
    objects: [...objects.values()],
    variables: Object.fromEntries(variables),
    warnings,
  };
}
