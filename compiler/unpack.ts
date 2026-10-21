/**
 * Unpack Entry .ent (tar.gz) → project.json + extracted media under assets/.
 */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as tar from 'tar';
import type { EntryProject } from './skeleton.ts';
import { ensureAssetsDir } from './assets.ts';
import { addLibraryAttribution, parseLibraryAttributions } from './library-media.ts';
import { MAX_LIBRARY_MANIFEST_BYTES, MAX_LIBRARY_PROJECT_BYTES, readLibraryFile } from '../src/library/media.ts';

export interface UnpackedMedia {
  /** Path relative to host assets/, e.g. imported/abc.svg */
  assetPath: string;
  absolutePath: string;
  kind: 'image' | 'sound';
  ext: string;
  fileId: string;
}

// node-tar names regular files File (typeflag 0), OldFile (NUL) or
// ContiguousFile (7); devices, FIFOs and links are deliberately excluded.
const REGULAR_FILE_TYPES = new Set(['File', 'OldFile', 'ContiguousFile']);

export interface UnpackResult {
  project: EntryProject;
  media: UnpackedMedia[];
  tempDir: string;
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
 * Extract an .ent archive, parse project.json, and copy bundled media into
 * `assets/imported/` so decompiled IR can reference stable paths.
 */
export async function unpackEnt(
  entPath: string,
  options: {
    cwd?: string;
    keepTemp?: boolean;
    maxEntryBytes?: number;
    maxTotalBytes?: number;
  } = {},
): Promise<UnpackResult> {
  const cwd = options.cwd ?? process.cwd();
  const absEnt =
    entPath.includes('/') || entPath.includes('\\') ? resolve(entPath) : resolveEntPath(entPath, cwd);

  const maxEntryBytes = options.maxEntryBytes ?? MAX_LIBRARY_PROJECT_BYTES;
  const maxTotalBytes = options.maxTotalBytes ?? MAX_LIBRARY_PROJECT_BYTES;
  if (
    !Number.isInteger(maxEntryBytes) || maxEntryBytes < 1 ||
    !Number.isInteger(maxTotalBytes) || maxTotalBytes < 1
  ) {
    throw new Error('unpack byte limits must be positive integers');
  }

  const stagingRoot = mkdtempSync(join(tmpdir(), 'entry-vibe-unpack-'));
  const tempDir = join(stagingRoot, 'temp');
  let extractedBytes = 0;
  let unsafeReason: string | undefined;

  try {
    await tar.x({
      file: absEnt,
      cwd: stagingRoot,
      filter: (path, entry) => {
        if (unsafeReason) return false;
        const reject = (reason: string): false => {
          unsafeReason = reason;
          return false;
        };
        const normalized = path.replace(/\\/g, '/');
        if (path.includes('\0')) {
          return reject('unsafe .ent entry: NUL byte in path');
        }
        if (normalized.startsWith('/') || /^[a-z]:/i.test(normalized)) {
          return reject(`unsafe .ent entry: absolute path ${JSON.stringify(path)}`);
        }
        if (normalized.split('/').includes('..')) {
          return reject(`unsafe .ent entry: path traversal ${JSON.stringify(path)}`);
        }
        const type = 'type' in entry ? String(entry.type) : '';
        if (type === 'SymbolicLink' || type === 'Link') {
          return reject(`unsafe .ent entry: link ${JSON.stringify(path)}`);
        }
        if (!REGULAR_FILE_TYPES.has(type) && type !== 'Directory') {
          return reject(`unsafe .ent entry: unsupported type ${type}`);
        }
        const size = Number(entry.size ?? 0);
        if (!Number.isSafeInteger(size) || size < 0) {
          return reject(`unsafe .ent entry: invalid size for ${JSON.stringify(path)}`);
        }
        if (size > maxEntryBytes) {
          return reject(`.ent entry exceeds ${maxEntryBytes} bytes: ${JSON.stringify(path)}`);
        }
        extractedBytes += size;
        if (extractedBytes > maxTotalBytes) {
          return reject(`.ent archive exceeds ${maxTotalBytes} extracted bytes`);
        }
        return true;
      },
    });
    if (unsafeReason) {
      throw new Error(unsafeReason);
    }
    const projectPath = join(tempDir, 'project.json');
    if (!existsSync(projectPath)) {
      throw new Error(`invalid .ent: missing temp/project.json in ${basename(absEnt)}`);
    }
    if (!lstatSync(projectPath).isFile()) {
      throw new Error('invalid .ent: temp/project.json must be a regular file');
    }

    const project = JSON.parse(readFileSync(projectPath, 'utf8')) as EntryProject;
    const attributionPath = join(tempDir, 'library-attribution.json');
    if (existsSync(attributionPath)) {
      if (!lstatSync(attributionPath).isFile()) {
        throw new Error('invalid library attribution: expected a regular file');
      }
      const document: unknown = JSON.parse(
        readLibraryFile(tempDir, 'library-attribution.json', MAX_LIBRARY_MANIFEST_BYTES).toString('utf8'),
      );
      if (!document || typeof document !== 'object' ||
          !('version' in document) || document.version !== 1 || !('objects' in document)) {
        throw new Error('invalid library attribution document');
      }
      for (const attribution of parseLibraryAttributions(document.objects)) {
        addLibraryAttribution(project, attribution);
      }
    }
    const assetsRoot = ensureAssetsDir(cwd);
    mkdirSync(join(assetsRoot, 'imported'), { recursive: true });

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
      if (!existsSync(dest)) {
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

    return { project, media, tempDir };
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
