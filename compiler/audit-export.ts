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

const HASH_MEDIA_RE =
  /^temp\/([0-9a-f]{2})\/([0-9a-f]{2})\/(image|thumb|sound)\/([0-9a-f]{32})(\.[A-Za-z0-9]+)$/;
const FILE_ID_RE = /^[0-9a-f]{32}$/;

function normalizeTarPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^(\.\/)+/, '');
}

function parseFunctionContent(rec: unknown): unknown[][] | undefined {
  if (typeof rec !== 'object' || rec === null) return undefined;
  const content = (rec as { content?: unknown }).content;
  if (typeof content !== 'string' || content === '') return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return undefined;
  }
  return Array.isArray(parsed) ? (parsed as unknown[][]) : undefined;
}

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

function countBlocks(
  project: EntryProject,
  functions: unknown[],
): {
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

  for (const fn of functions) {
    const rec = fn as { id?: string };
    const content = parseFunctionContent(fn);
    if (!content) continue;
    let n = 0;
    walkScriptBlocks(content, () => {
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

function collectFunctionIds(functions: unknown[]): Set<string> {
  const ids = new Set<string>();
  for (const fn of functions) {
    const id =
      typeof fn === 'object' && fn !== null ? (fn as { id?: unknown }).id : undefined;
    if (typeof id === 'string' && id.length > 0) ids.add(id);
  }
  return ids;
}

function isBadMediaUrl(url: string): boolean {
  return url.includes('temp/media/') || url.startsWith('media/');
}

function mediaUrlProblem(
  rawUrl: string,
  expectedKind: 'image' | 'thumb' | 'sound',
  expectedFileId?: string,
): string | undefined {
  const url = normalizeTarPath(rawUrl);
  if (!url) return 'is empty';
  if (url.startsWith('host-asset:')) {
    return 'still uses a host-asset: marker (run compile_project → packEnt to materialize media)';
  }
  if (isBadMediaUrl(url)) return 'uses flat temp/media/ layout';
  const match = HASH_MEDIA_RE.exec(url);
  if (!match) return `is not a hash media path ("${url}")`;
  const prefixA = match[1]!;
  const prefixB = match[2]!;
  const kind = match[3]!;
  const fileId = match[4]!;
  if (kind !== expectedKind) return `points at "${kind}/" instead of "${expectedKind}/"`;
  if (fileId.slice(0, 2) !== prefixA || fileId.slice(2, 4) !== prefixB) {
    return `has folder prefix "${prefixA}/${prefixB}" that does not match file id "${fileId}"`;
  }
  if (expectedFileId && fileId !== expectedFileId) {
    return `file id "${fileId}" does not match filename "${expectedFileId}"`;
  }
  return undefined;
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
  const tarPaths = options.tarPaths
    ? new Set(options.tarPaths.map(normalizeTarPath))
    : undefined;
  const mediaIds = new Set<string>();
  const addHint = (hint: string): void => {
    if (!hints.includes(hint)) hints.push(hint);
  };
  const repackHint =
    'Repack with compile_project → packEnt (hash folder layout under temp/ab/cd/).';

  for (const obj of project.objects as Array<Record<string, unknown>>) {
    if (!sceneIds.has(String(obj.scene))) {
      errors.push(`object "${obj.name}" references missing scene "${obj.scene}"`);
    }
    if (obj.objectType !== 'sprite') continue;

    const sprite = obj.sprite as
      | {
          pictures?: Array<{
            name?: string;
            fileurl?: string;
            thumbUrl?: string;
            filename?: string;
          }>;
          sounds?: Array<{ name?: string; fileurl?: string; filename?: string }>;
        }
      | undefined;

    if (!sprite?.pictures?.length) {
      errors.push(`sprite "${obj.name}" has no pictures`);
    } else {
      for (const pic of sprite.pictures) {
        const url = String(pic.fileurl ?? '');
        const thumbUrl = String(pic.thumbUrl ?? '');
        if (isBadMediaUrl(url) || isBadMediaUrl(thumbUrl)) {
          errors.push(
            `sprite "${obj.name}" uses flat temp/media/ path — Entry Offline cannot load it`,
          );
          addHint(repackHint);
          break;
        }

        const filename = typeof pic.filename === 'string' ? pic.filename : '';
        const label = pic.name ? `picture "${pic.name}"` : 'picture';
        if (filename && !FILE_ID_RE.test(filename)) {
          errors.push(
            `sprite "${obj.name}" ${label} filename "${filename}" is not a 32-char lowercase hex id`,
          );
        } else if (filename) {
          if (mediaIds.has(filename)) {
            errors.push(`duplicate media file id "${filename}" (sprite "${obj.name}")`);
          } else {
            mediaIds.add(filename);
          }
        }
        const expectedId = FILE_ID_RE.test(filename) ? filename : undefined;
        if (!filename && HASH_MEDIA_RE.test(normalizeTarPath(url))) {
          errors.push(`sprite "${obj.name}" ${label} has a hash fileurl but no filename`);
        }

        const urlProblem = mediaUrlProblem(url, 'image', expectedId);
        if (urlProblem) {
          errors.push(`sprite "${obj.name}" ${label} fileurl ${urlProblem}`);
          addHint(repackHint);
        }
        const thumbProblem = mediaUrlProblem(thumbUrl, 'thumb', expectedId);
        if (thumbProblem) {
          errors.push(`sprite "${obj.name}" ${label} thumbUrl ${thumbProblem}`);
          addHint(repackHint);
        }

        if (tarPaths) {
          for (const [field, raw] of [
            ['fileurl', url],
            ['thumbUrl', thumbUrl],
          ] as const) {
            const member = normalizeTarPath(raw);
            if (HASH_MEDIA_RE.test(member) && !tarPaths.has(member)) {
              errors.push(
                `sprite "${obj.name}" ${label} ${field} "${member}" is missing from .ent archive`,
              );
            }
          }
        }
      }
    }

    for (const sound of sprite?.sounds ?? []) {
      const url = String(sound.fileurl ?? '');
      if (isBadMediaUrl(url)) {
        errors.push(`sprite "${obj.name}" sound uses invalid path "${url}"`);
        continue;
      }

      const filename = typeof sound.filename === 'string' ? sound.filename : '';
      const label = sound.name ? `sound "${sound.name}"` : 'sound';
      if (filename && !FILE_ID_RE.test(filename)) {
        errors.push(
          `sprite "${obj.name}" ${label} filename "${filename}" is not a 32-char lowercase hex id`,
        );
      } else if (filename) {
        if (mediaIds.has(filename)) {
          errors.push(`duplicate media file id "${filename}" (sprite "${obj.name}")`);
        } else {
          mediaIds.add(filename);
        }
      }
      const expectedId = FILE_ID_RE.test(filename) ? filename : undefined;
      if (!filename && HASH_MEDIA_RE.test(normalizeTarPath(url))) {
        errors.push(`sprite "${obj.name}" ${label} has a hash fileurl but no filename`);
      }

      const problem = mediaUrlProblem(url, 'sound', expectedId);
      if (problem) {
        errors.push(`sprite "${obj.name}" ${label} fileurl ${problem}`);
        addHint(repackHint);
      }
      if (tarPaths) {
        const member = normalizeTarPath(url);
        if (HASH_MEDIA_RE.test(member) && !tarPaths.has(member)) {
          errors.push(
            `sprite "${obj.name}" ${label} fileurl "${member}" is missing from .ent archive`,
          );
        }
      }
    }
  }

  if (options.tarPaths?.some((p) => p.includes('temp/media/'))) {
    errors.push('.ent archive contains temp/media/ flat paths instead of hash folders');
    addHint('Run compile_project + packEnt; do not hand-zip project.json with temp/media/.');
  }

  const functions = Array.isArray(project.functions) ? project.functions : [];
  const fnIds = collectFunctionIds(functions);

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

  const seenFnIds = new Set<string>();
  for (let i = 0; i < functions.length; i++) {
    const fn = functions[i];
    if (typeof fn !== 'object' || fn === null) {
      errors.push(`functions[${i}] must be an object`);
      continue;
    }
    const rec = fn as { id?: unknown; content?: unknown };
    const id = typeof rec.id === 'string' ? rec.id : '';
    const label = id ? `function "${id}"` : `functions[${i}]`;
    if (!id) {
      errors.push(`functions[${i}] is missing a string id`);
    } else if (seenFnIds.has(id)) {
      errors.push(`duplicate function id "${id}"`);
    } else {
      seenFnIds.add(id);
    }

    if (typeof rec.content !== 'string' || rec.content === '') {
      errors.push(`${label} is missing content`);
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(rec.content);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${label} content is not valid JSON: ${msg}`);
      continue;
    }
    if (!Array.isArray(parsed)) {
      errors.push(`${label} content must be an array of threads`);
      continue;
    }
    walkScriptBlocks(parsed, (block, path) => {
      auditBlockParams(block, index, path, errors);
      const type = String(block.type ?? '');
      if (type.startsWith('func_')) {
        const fnId = type.slice('func_'.length);
        if (!fnIds.has(fnId)) {
          errors.push(`${path}: calls ${type} but no function with id "${fnId}" is defined`);
        }
      }
    }, `fn:${id || '?'}`);
  }

  const counts = countBlocks(project, functions);
  const fnCount = functions.length;

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
