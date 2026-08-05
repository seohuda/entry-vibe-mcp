/**
 * Audit compiled Entry project.json (and optional .ent tar paths) for issues
 * common in host-generated exports — especially raw JSON that bypasses compile_project.
 */
import type { BlockCatalog, BlockSchema } from '../src/types/block.ts';
import type { EntryProject } from './skeleton.ts';
import { catalogIndex, loadCatalog } from './validate.ts';

export interface ExportAuditOptions {
  catalog?: BlockCatalog;
  /** Tar member paths when auditing a packed .ent (optional). */
  tarPaths?: string[];
}

export interface ExportAuditResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  hints: string[];
  stats: {
    blockCount: number;
    objectScriptBlocks: number;
    functionBlocks: number;
    functionCount: number;
  };
}

const SKIP_BLOCK_TYPES = new Set([
  'number',
  'text',
  'True',
  'False',
  'function_field_label',
]);

function parseObjectScripts(obj: Record<string, unknown>): unknown[][] {
  const raw = obj.script;
  if (typeof raw === 'string') {
    return JSON.parse(raw || '[]') as unknown[][];
  }
  return (raw as unknown[][]) ?? [];
}

function walkScriptBlocks(
  value: unknown,
  visit: (block: Record<string, unknown>, path: string) => void,
  path: string,
): void {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      walkScriptBlocks(value[i], visit, `${path}[${i}]`);
    }
    return;
  }
  if (typeof value !== 'object' || value === null) return;

  const rec = value as Record<string, unknown>;
  if (typeof rec.type === 'string') {
    visit(rec, path || rec.type);
    const params = rec.params as unknown[] | undefined;
    if (params) {
      for (let i = 0; i < params.length; i++) {
        const p = params[i];
        if (typeof p === 'object' && p !== null && 'type' in (p as object)) {
          walkScriptBlocks(p, visit, `${path}/${rec.type}.p${i}`);
        }
      }
    }
    const statements = rec.statements as unknown[][] | undefined;
    if (statements) {
      for (let si = 0; si < statements.length; si++) {
        walkScriptBlocks(statements[si], visit, `${path}/${rec.type}.s${si}`);
      }
    }
  }
}

function countBlocks(project: EntryProject): {
  total: number;
  objectScript: number;
  functionBlocks: number;
} {
  let total = 0;
  let objectScript = 0;
  let functionBlocks = 0;

  for (const obj of project.objects as Array<Record<string, unknown>>) {
    let n = 0;
    walkScriptBlocks(parseObjectScripts(obj), () => {
      n++;
    }, obj.name as string);
    objectScript += n;
    total += n;
  }

  for (const fn of project.functions ?? []) {
    const rec = fn as { id?: string; content?: string };
    if (!rec.content) continue;
    let n = 0;
    walkScriptBlocks(JSON.parse(rec.content), () => {
      n++;
    }, `fn:${rec.id ?? '?'}`);
    functionBlocks += n;
    total += n;
  }

  return { total, objectScript, functionBlocks };
}

function auditBlockParams(
  block: Record<string, unknown>,
  index: Map<string, BlockSchema>,
  path: string,
  errors: string[],
): void {
  const type = String(block.type ?? '');
  if (SKIP_BLOCK_TYPES.has(type) || type.startsWith('func_')) return;

  const schema = index.get(type);
  if (!schema) {
    errors.push(`${path}: unknown block type "${type}"`);
    return;
  }

  const params = block.params;
  if (!schema.params.length || params === undefined) return;
  if (!Array.isArray(params)) {
    errors.push(`${path}: "${type}" params must be an array`);
    return;
  }

  for (let i = 0; i < schema.params.length; i++) {
    const ps = schema.params[i]!;
    if (ps.type === 'Indicator' || ps.type === 'LineBreak') continue;
    const val = params[i];
    if (ps.type === 'Dropdown' || ps.type === 'DropdownDynamic') {
      if (val !== null && val !== undefined && typeof val !== 'string') {
        errors.push(
          `${path}: "${type}" param ${ps.key} (slot ${i}) must be a string id, got ${typeof val}`,
        );
      }
    } else if (ps.type === 'Block') {
      if (val !== null && val !== undefined) {
        if (typeof val !== 'object' || val === null || !('type' in (val as object))) {
          errors.push(`${path}: "${type}" param ${ps.key} (slot ${i}) must be a nested block`);
        }
      }
    }
  }
}

function collectFunctionIds(project: EntryProject): Set<string> {
  return new Set((project.functions ?? []).map((f) => String((f as { id: string }).id)));
}

function isBadMediaUrl(url: string): boolean {
  return url.includes('temp/media/') || url.startsWith('media/');
}

export function auditCompiledProject(
  project: EntryProject,
  options: ExportAuditOptions = {},
): ExportAuditResult {
  const catalog = options.catalog ?? loadCatalog();
  const index = catalogIndex(catalog);
  const errors: string[] = [];
  const warnings: string[] = [];
  const hints: string[] = [];

  if (!project.name || project.name === 'undefined') {
    errors.push('project.name is missing — Entry shows title "undefined"');
    hints.push('Set project.name (compile_project does this automatically).');
  }

  if (!Array.isArray(project.objects) || project.objects.length === 0) {
    errors.push('project.objects is empty');
  }

  if (!Array.isArray(project.scenes) || project.scenes.length === 0) {
    errors.push('project.scenes is empty');
  }

  const sceneIds = new Set((project.scenes ?? []).map((s) => s.id));
  for (const obj of project.objects as Array<Record<string, unknown>>) {
    if (!sceneIds.has(String(obj.scene))) {
      errors.push(`object "${obj.name}" references missing scene "${obj.scene}"`);
    }
    if (obj.objectType === 'sprite') {
      const sprite = obj.sprite as { pictures?: Array<{ fileurl?: string }>; sounds?: Array<{ fileurl?: string }> } | undefined;
      if (!sprite?.pictures?.length) {
        errors.push(`sprite "${obj.name}" has no pictures`);
      } else {
        for (const pic of sprite.pictures) {
          const url = String(pic.fileurl ?? '');
          if (isBadMediaUrl(url)) {
            errors.push(
              `sprite "${obj.name}" uses flat temp/media/ path — Entry Offline cannot load it`,
            );
            hints.push('Repack with compile_project → packEnt (hash folder layout under temp/ab/cd/).');
            break;
          }
        }
      }
      for (const sound of sprite?.sounds ?? []) {
        const url = String(sound.fileurl ?? '');
        if (isBadMediaUrl(url)) {
          errors.push(`sprite "${obj.name}" sound uses invalid path "${url}"`);
          break;
        }
      }
    }
  }

  if (options.tarPaths?.some((p) => p.includes('temp/media/'))) {
    errors.push('.ent archive contains temp/media/ flat paths instead of hash folders');
    hints.push('Run compile_project + packEnt; do not hand-zip project.json with temp/media/.');
  }

  const fnIds = collectFunctionIds(project);

  for (const obj of project.objects as Array<Record<string, unknown>>) {
    walkScriptBlocks(parseObjectScripts(obj), (block, path) => {
      auditBlockParams(block, index, path, errors);
      const type = String(block.type ?? '');
      if (type.startsWith('func_')) {
        const id = type.slice('func_'.length);
        if (!fnIds.has(id)) {
          errors.push(`${path}: calls ${type} but no function with id "${id}" is defined`);
        }
      }
    }, String(obj.name));
  }

  for (const fn of project.functions ?? []) {
    const rec = fn as { id?: string; content?: string };
    if (!rec.content) continue;
    walkScriptBlocks(JSON.parse(rec.content), (block, path) => {
      auditBlockParams(block, index, path, errors);
      const type = String(block.type ?? '');
      if (type.startsWith('func_')) {
        const id = type.slice('func_'.length);
        if (!fnIds.has(id)) {
          errors.push(`${path}: calls ${type} but no function with id "${id}" is defined`);
        }
      }
    }, `fn:${rec.id ?? '?'}`);
  }

  const counts = countBlocks(project);
  const fnCount = project.functions?.length ?? 0;

  if (fnCount > 0 && counts.functionBlocks > counts.objectScript) {
    hints.push(
      `${counts.functionBlocks} blocks live in the "함수" tab (${fnCount} function(s)); ` +
        `object scripts only have ${counts.objectScript} blocks. ` +
        'In Entry, open the 함수 tab — the block workspace looks empty if you only check the sprite.',
    );
  }

  for (const obj of project.objects as Array<Record<string, unknown>>) {
    if (obj.objectType === 'textBox') {
      const n = parseObjectScripts(obj).flat().length;
      if (n === 0) {
        hints.push(
          `Text box "${obj.name}" has no blocks — select sprite objects in the object list to see scripts.`,
        );
      }
    }
  }

  if (counts.objectScript === 0 && fnCount === 0) {
    warnings.push('No blocks found in object scripts or functions');
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    hints,
    stats: {
      blockCount: counts.total,
      objectScriptBlocks: counts.objectScript,
      functionBlocks: counts.functionBlocks,
      functionCount: fnCount,
    },
  };
}
