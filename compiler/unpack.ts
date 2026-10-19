/**
 * Unpack Entry .ent (tar.gz) → project.json + extracted media under assets/.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, extname, isAbsolute, join, posix, relative, resolve } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as tar from 'tar';
import type { EntryProject } from './skeleton.ts';
import { assetsDir, ensureAssetsDir } from './assets.ts';

export interface UnpackedMedia {
  /** Path relative to host assets/, e.g. imported/abc.svg */
  assetPath: string;
  absolutePath: string;
  kind: 'image' | 'sound';
  ext: string;
  fileId: string;
}

export interface UnpackOptions {
  cwd?: string;
  keepTemp?: boolean;
  /** Copy bundled media into assets/imported (default true). */
  extractMedia?: boolean;
  /** Override the media destination root (defaults to the host assets/ dir). */
  assetsRoot?: string;
  /** Maximum number of archive entries (default 20000). */
  maxEntries?: number;
  /** Maximum total uncompressed bytes (default 512 MiB). */
  maxTotalBytes?: number;
  /** Maximum uncompressed size of a single file (default 64 MiB). */
  maxFileBytes?: number;
}

export interface UnpackResult {
  project: EntryProject;
  media: UnpackedMedia[];
  tempDir: string;
  /** Safe, normalized relative paths contained in the archive. */
  tarPaths: string[];
}

const DEFAULT_MAX_ENTRIES = 20_000;
const DEFAULT_MAX_TOTAL_BYTES = 512 * 1024 * 1024;
const DEFAULT_MAX_FILE_BYTES = 64 * 1024 * 1024;
const SAFE_TAR_TYPES = new Set(['File', 'OldFile', 'ContiguousFile', 'Directory', 'GNUDumpDir']);

function positiveLimit(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive finite number`);
  }
  return Math.floor(value);
}

function safeTarPath(raw: string): string {
  if (!raw || raw.includes('\0')) {
    throw new Error(`unsafe archive entry path: ${JSON.stringify(raw)}`);
  }
  const slashed = raw.replace(/\\/g, '/');
  if (slashed.startsWith('/') || /^[a-zA-Z]:\//.test(slashed) || isAbsolute(slashed)) {
    throw new Error(`archive entry must be relative: ${JSON.stringify(raw)}`);
  }
  if (slashed.split('/').some((segment) => segment === '..')) {
    throw new Error(`archive entry escapes extraction root: ${JSON.stringify(raw)}`);
  }
  const normalized = posix.normalize(slashed).replace(/^\.\//, '');
  if (normalized === '..' || normalized.startsWith('../') || normalized.startsWith('/')) {
    throw new Error(`archive entry escapes extraction root: ${JSON.stringify(raw)}`);
  }
  return normalized;
}

function resolveDirectEntPath(entPath: string, cwd: string): string {
  const raw = entPath.trim();
  if (!raw || raw.includes('\0')) {
    throw new Error(`invalid .ent path: ${JSON.stringify(entPath)}`);
  }
  if (!raw.toLowerCase().endsWith('.ent')) {
    throw new Error(`path must end with .ent: ${JSON.stringify(entPath)}`);
  }
  const abs = resolve(cwd, raw);
  if (!existsSync(abs)) {
    throw new Error(`.ent file not found: ${abs}`);
  }
  if (!statSync(abs).isFile()) {
    throw new Error(`.ent path is not a file: ${abs}`);
  }
  return abs;
}

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(p));
    else out.push(p);
  }
  return out;
}

function mediaKindFromPath(p: string): 'image' | 'sound' | undefined {
  if (p.includes('/sound/')) return 'sound';
  if (p.includes('/image/')) return 'image';
  return undefined;
}

/** Resolve .ent path under cwd; reject traversal. */
export function resolveEntPath(filename: string, cwd = process.cwd()): string {
  const raw = filename.trim();
  if (!raw || raw.includes('\0') || raw.includes('..')) {
    throw new Error(`invalid .ent filename: ${JSON.stringify(filename)}`);
  }
  const base = basename(raw);
  const normalized = raw.replace(/\\/g, '/');
  if (normalized.includes('/') && basename(normalized) !== normalized) {
    throw new Error(`filename must not contain path separators: ${JSON.stringify(filename)}`);
  }
  if (!base.toLowerCase().endsWith('.ent')) {
    throw new Error(`filename must end with .ent: ${JSON.stringify(filename)}`);
  }
  const abs = resolve(cwd, base);
  if (!existsSync(abs)) {
    throw new Error(`.ent file not found: ${abs}`);
  }
  return abs;
}

/**
 * Extract an .ent archive, parse project.json, and optionally copy bundled
 * media into `assets/imported/` so decompiled IR can reference stable paths.
 */
export async function unpackEnt(
  entPath: string,
  options: UnpackOptions = {},
): Promise<UnpackResult> {
  const cwd = options.cwd ?? process.cwd();
  const absEnt =
    entPath.includes('/') || entPath.includes('\\')
      ? resolveDirectEntPath(entPath, cwd)
      : resolveEntPath(entPath, cwd);

  const maxEntries = positiveLimit(options.maxEntries, DEFAULT_MAX_ENTRIES, 'maxEntries');
  const maxTotalBytes = positiveLimit(
    options.maxTotalBytes,
    DEFAULT_MAX_TOTAL_BYTES,
    'maxTotalBytes',
  );
  const maxFileBytes = positiveLimit(options.maxFileBytes, DEFAULT_MAX_FILE_BYTES, 'maxFileBytes');

  const stagingRoot = mkdtempSync(join(tmpdir(), 'entry-vibe-unpack-'));
  const tempDir = join(stagingRoot, 'temp');
  const tarPaths = new Set<string>();
  const violations: string[] = [];
  let entryCount = 0;
  let totalBytes = 0;

  try {
    await tar.x({
      file: absEnt,
      cwd: stagingRoot,
      // tar writes the entry even when the filter throws (the error becomes an
      // uncaught stream error instead of rejecting this promise), so record
      // violations, skip entries, and reject after tar.x resolves.
      filter: (path, entry) => {
        const rejectEntry = (message: string): false => {
          violations.push(message);
          return false;
        };
        if (violations.length > 0) return false;
        let safe: string;
        try {
          safe = safeTarPath(path);
        } catch (err) {
          return rejectEntry(err instanceof Error ? err.message : String(err));
        }
        const entryType = 'type' in entry ? entry.type : 'unknown';
        if (!SAFE_TAR_TYPES.has(entryType)) {
          return rejectEntry(
            `unsupported archive entry type ${JSON.stringify(entryType)} for ${JSON.stringify(path)}; ` +
              'only regular files and directories are allowed',
          );
        }
        entryCount += 1;
        if (entryCount > maxEntries) {
          return rejectEntry(`archive contains more than ${maxEntries} entries`);
        }
        const size = Number.isFinite(entry.size) ? entry.size : 0;
        if (size < 0) {
          return rejectEntry(`archive entry has invalid size: ${JSON.stringify(path)}`);
        }
        if (size > maxFileBytes) {
          return rejectEntry(
            `archive entry ${JSON.stringify(path)} exceeds maxFileBytes (${size} > ${maxFileBytes})`,
          );
        }
        totalBytes += size;
        if (totalBytes > maxTotalBytes) {
          return rejectEntry(`archive exceeds maxTotalBytes (${totalBytes} > ${maxTotalBytes})`);
        }
        tarPaths.add(safe);
        return true;
      },
    });

    if (violations.length > 0) {
      throw new Error(violations[0]);
    }

    const projectPath = join(tempDir, 'project.json');
    if (!existsSync(projectPath) || !statSync(projectPath).isFile()) {
      throw new Error(`invalid .ent: missing temp/project.json in ${basename(absEnt)}`);
    }

    const project = JSON.parse(readFileSync(projectPath, 'utf8')) as EntryProject;
    const extractMedia = options.extractMedia !== false;
    const assetsRoot = options.assetsRoot ?? (extractMedia ? ensureAssetsDir(cwd) : assetsDir(cwd));
    if (extractMedia) {
      mkdirSync(join(assetsRoot, 'imported'), { recursive: true });
    }

    const media: UnpackedMedia[] = [];
    const byFileId = new Map<string, UnpackedMedia>();

    for (const file of walkFiles(tempDir)) {
      const rel = relative(tempDir, file).replace(/\\/g, '/');
      const kind = mediaKindFromPath(rel);
      if (!kind) continue;
      const ext = extname(file).toLowerCase().slice(1);
      if (kind === 'image' && ext !== 'svg' && ext !== 'png') continue;
      if (kind === 'sound' && ext !== 'mp3') continue;

      const fileId = basename(file, extname(file));
      const assetRel = `imported/${fileId}.${ext}`;
      const dest = join(assetsRoot, assetRel);
      if (extractMedia && !existsSync(dest)) {
        writeFileSync(dest, readFileSync(file));
      }

      const entry: UnpackedMedia = {
        assetPath: assetRel,
        absolutePath: dest,
        kind,
        ext,
        fileId,
      };

      const prev = byFileId.get(`${kind}:${fileId}`);
      if (!prev) {
        byFileId.set(`${kind}:${fileId}`, entry);
        media.push(entry);
      } else if (kind === 'image' && ext === 'svg' && prev.ext === 'png') {
        const idx = media.indexOf(prev);
        if (idx >= 0) media[idx] = entry;
        byFileId.set(`${kind}:${fileId}`, entry);
      }
    }

    return { project, media, tempDir, tarPaths: [...tarPaths] };
  } finally {
    if (!options.keepTemp) {
      rmSync(stagingRoot, { recursive: true, force: true });
    }
  }
}

/** Map hash file id → assets/imported/ path from unpack result. */
export function mediaPathByFileId(media: UnpackedMedia[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of media) {
    map.set(m.fileId, `assets/${m.assetPath}`);
  }
  return map;
}
