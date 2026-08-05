/**
 * Structural smoke test: validate IR, compile, and sanity-check the result.
 * Does not launch Entry Offline — catches issues before .ent export.
 */
import type { EntryIR, IRBlock, Thread } from '../src/types/ir.ts';
import { compileProject } from './compile.ts';
import { catalogIndex, loadCatalog, validateProject } from './validate.ts';
import type { BlockSchema } from '../src/types/block.ts';
import type { EntryProject } from './skeleton.ts';

export interface SmokeCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface SmokeResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  checks: SmokeCheck[];
}

function isIRBlock(value: unknown): value is IRBlock {
  return typeof value === 'object' && value !== null && 'type' in value;
}

function collectBlockTypes(thread: Thread, out: Set<string>): void {
  for (const block of thread) {
    out.add(block.type);
    if (block.params) {
      for (const val of Object.values(block.params)) {
        if (isIRBlock(val)) collectBlockTypes([val], out);
      }
    }
    if (block.statements) {
      for (const t of Object.values(block.statements)) collectBlockTypes(t, out);
    }
  }
}

function collectProjectBlockTypes(project: EntryProject, index: Map<string, BlockSchema>): string[] {
  const unknown: string[] = [];
  const visitCompiled = (blocks: unknown[]) => {
    for (const b of blocks) {
      if (typeof b !== 'object' || b === null) continue;
      const rec = b as Record<string, unknown>;
      const type = String(rec.type ?? '');
      if (type.startsWith('func_')) continue;
      if (type === 'function_field_label') continue;
      if (type === 'number' || type === 'text' || type === 'True' || type === 'False') continue;
      if (type && !index.has(type)) {
        unknown.push(type);
      }
      const statements = rec.statements as unknown[][] | undefined;
      if (statements) {
        for (const t of statements) visitCompiled(t);
      }
      const params = rec.params as unknown[] | undefined;
      if (params) {
        for (const p of params) {
          if (typeof p === 'object' && p !== null && 'type' in (p as object)) {
            visitCompiled([p]);
          }
        }
      }
    }
  };

  for (const obj of project.objects) {
    const raw = obj.script;
    const scripts =
      typeof raw === 'string' ? (JSON.parse(raw) as unknown[][]) : (raw as unknown[][]);
    for (const thread of scripts) visitCompiled(thread);
  }

  for (const fn of project.functions ?? []) {
    const rec = fn as { content?: string };
    if (!rec.content) continue;
    try {
      const content = JSON.parse(rec.content) as unknown[][][];
      for (const thread of content) visitCompiled(thread.flat());
    } catch {
      // skip
    }
  }

  return unknown;
}

function parseScripts(project: EntryProject): unknown[][][] {
  const out: unknown[][][] = [];
  for (const obj of project.objects) {
    const raw = obj.script;
    if (typeof raw === 'string') {
      out.push(JSON.parse(raw) as unknown[][]);
    } else if (Array.isArray(raw)) {
      out.push(raw as unknown[][]);
    }
  }
  return out;
}

export function smokeTestProject(ir: EntryIR): SmokeResult {
  const checks: SmokeCheck[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  const validation = validateProject(ir);
  checks.push({
    name: 'validate_project',
    ok: validation.valid,
    detail: validation.valid ? 'IR valid' : validation.errors.join('; '),
  });
  if (!validation.valid) {
    errors.push(...validation.errors);
    return { ok: false, errors, warnings, checks };
  }

  let project: EntryProject;
  try {
    project = compileProject(ir);
    checks.push({ name: 'compile_project', ok: true, detail: `${project.objects.length} object(s)` });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    checks.push({ name: 'compile_project', ok: false, detail: msg });
    errors.push(msg);
    return { ok: false, errors, warnings, checks };
  }

  const index = catalogIndex(loadCatalog());
  const irTypes = new Set<string>();
  for (const obj of ir.objects) {
    for (const thread of obj.scripts) collectBlockTypes(thread, irTypes);
  }
  for (const fn of ir.functions ?? []) {
    for (const block of fn.body) collectBlockTypes([block], irTypes);
    if (fn.returnValue && isIRBlock(fn.returnValue)) collectBlockTypes([fn.returnValue], irTypes);
  }

  const missingInCatalog = [...irTypes].filter(
    (t) => t !== 'function_call' && !index.has(t),
  );
  checks.push({
    name: 'catalog_coverage',
    ok: missingInCatalog.length === 0,
    detail: missingInCatalog.length ? `unknown types: ${missingInCatalog.join(', ')}` : 'all block types known',
  });
  if (missingInCatalog.length > 0) {
    errors.push(`IR references unknown block types: ${missingInCatalog.join(', ')}`);
  }

  const unknownCompiled = collectProjectBlockTypes(project, index);
  checks.push({
    name: 'compiled_block_types',
    ok: unknownCompiled.length === 0,
    detail: unknownCompiled.length ? unknownCompiled.join(', ') : 'compiled blocks resolve in catalog',
  });
  if (unknownCompiled.length > 0) {
    errors.push(`compiled project has unknown block types: ${unknownCompiled.join(', ')}`);
  }

  const scripts = parseScripts(project);
  let hatOk = true;
  for (const objScripts of scripts) {
    for (const thread of objScripts) {
      if (!Array.isArray(thread) || thread.length === 0) {
        hatOk = false;
        break;
      }
      const first = thread[0] as Record<string, unknown> | undefined;
      const schema = first?.type ? index.get(String(first.type)) : undefined;
      if (!schema?.isHat || schema.skeleton !== 'basic_event') {
        // text-only objects may have empty scripts — skip
        if (thread.length === 0) continue;
      }
    }
  }
  checks.push({
    name: 'script_threads_nonempty',
    ok: hatOk,
    detail: hatOk ? 'object script threads present' : 'some threads empty or missing event hat',
  });
  if (!hatOk) {
    warnings.push('Some object script threads are empty or missing an event hat');
  }

  if (project.objects.length === 0) {
    errors.push('compiled project has no objects');
    checks.push({ name: 'object_count', ok: false, detail: '0 objects' });
  } else {
    checks.push({
      name: 'object_count',
      ok: true,
      detail: `${project.objects.length} object(s), ${project.scenes.length} scene(s)`,
    });
  }

  const sceneRefErrors: string[] = [];
  const sceneIds = new Set(project.scenes.map((s) => s.id));
  for (const obj of project.objects as Array<Record<string, unknown>>) {
    if (!sceneIds.has(String(obj.scene))) {
      sceneRefErrors.push(`object "${obj.name}" references missing scene ${obj.scene}`);
    }
  }
  errors.push(...sceneRefErrors);
  checks.push({
    name: 'scene_references',
    ok: sceneRefErrors.length === 0,
    detail: sceneRefErrors.length ? sceneRefErrors.join('; ') : 'all objects bound to existing scenes',
  });

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    checks,
  };
}
