/**
 * Host-project asset paths: files the LLM drops under `assets/` (png/svg)
 * that the compiler packs into .ent archives.
 */
import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { basename, extname, isAbsolute, join, normalize, relative } from 'node:path';

const ALLOWED_EXT = new Set(['.png', '.svg']);

/** Host cwd `assets/` (or package-relative when an explicit root is passed). */
export function assetsDir(root?: string): string {
  if (process.env.ENTRY_VIBE_ASSETS_DIR) return process.env.ENTRY_VIBE_ASSETS_DIR;
  if (root === undefined) return join(process.cwd(), 'assets');
  return join(root, 'assets');
}

export function ensureAssetsDir(root?: string): string {
  const dir = assetsDir(root);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export type ImageType = 'png' | 'svg';

export interface ResolvedHostAsset {
  /** Path relative to assetsDir, using `/` separators (e.g. `cat.png`). */
  relativePath: string;
  /** Absolute filesystem path. */
  absolutePath: string;
  imageType: ImageType;
  fileName: string;
}

/**
 * Normalize an IR picture path to a path relative to `assets/`.
 * Accepts `assets/foo.png` or `foo.png`. Rejects escapes and bad extensions.
 */
export function normalizeAssetRelPath(input: string): string {
  if (!input || typeof input !== 'string') {
    throw new Error('asset path is required');
  }
  if (input.includes('\0')) {
    throw new Error(`asset path must not contain NUL: ${JSON.stringify(input)}`);
  }
  let raw = input.trim().replace(/\\/g, '/');
  if (isAbsolute(raw) || /^[a-zA-Z]:\//.test(raw)) {
    throw new Error(`asset path must be relative, not absolute: ${JSON.stringify(input)}`);
  }
  if (raw.startsWith('assets/')) {
    raw = raw.slice('assets/'.length);
  } else if (raw === 'assets') {
    throw new Error('asset path must point to a file under assets/, not the folder itself');
  }
  const norm = normalize(raw).replace(/\\/g, '/');
  if (norm.startsWith('../') || norm === '..' || norm.startsWith('/') || norm.includes('/../')) {
    throw new Error(`asset path escapes assets/: ${JSON.stringify(input)}`);
  }
  const ext = extname(norm).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    throw new Error(
      `asset path must end with .png or .svg (got ${JSON.stringify(input)}); ` +
        'jpg/webp are not supported in v1',
    );
  }
  if (!norm || norm.endsWith('/')) {
    throw new Error(`asset path must be a file: ${JSON.stringify(input)}`);
  }
  return norm;
}

export function resolveHostAsset(
  input: string,
  root?: string,
): ResolvedHostAsset {
  const relativePath = normalizeAssetRelPath(input);
  const dir = assetsDir(root);
  const absolutePath = join(dir, ...relativePath.split('/'));

  // Containment check even before the file exists (for clearer errors).
  const relToAssets = relative(dir, absolutePath);
  if (relToAssets.startsWith('..') || isAbsolute(relToAssets)) {
    throw new Error(`asset path escapes assets/: ${JSON.stringify(input)}`);
  }

  if (!existsSync(absolutePath)) {
    throw new Error(
      `asset not found: ${JSON.stringify(input)} (resolved ${absolutePath}). ` +
        'Write the image under the host project assets/ folder first.',
    );
  }

  // After existence, confirm realpath stays inside assets/ (symlink escape).
  try {
    const realAssets = realpathSync(dir);
    const realFile = realpathSync(absolutePath);
    const rel = relative(realAssets, realFile);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error(`asset path escapes assets/: ${JSON.stringify(input)}`);
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('escapes')) throw err;
    // realpath can fail on exotic FS; existence check above already passed.
  }

  const ext = extname(relativePath).toLowerCase() as '.png' | '.svg';
  return {
    relativePath,
    absolutePath,
    imageType: ext === '.svg' ? 'svg' : 'png',
    fileName: basename(relativePath),
  };
}

/** Marker prefix stored on picture.fileurl before prepareExport rewrites it. */
export const HOST_ASSET_PREFIX = 'host-asset:';

export function hostAssetMarker(relativePathUnderAssets: string): string {
  return `${HOST_ASSET_PREFIX}${relativePathUnderAssets.replace(/\\/g, '/')}`;
}

export function parseHostAssetMarker(fileurl: string | undefined): string | undefined {
  if (!fileurl?.startsWith(HOST_ASSET_PREFIX)) return undefined;
  return fileurl.slice(HOST_ASSET_PREFIX.length);
}

/**
 * Best-effort image dimensions for Entry entity/picture metadata.
 * Falls back to Entrybot defaults when parsing fails.
 */
export function readImageDimension(
  absolutePath: string,
  imageType: ImageType,
): { width: number; height: number } {
  const fallback = { width: 144, height: 246 };
  try {
    const buf = readFileSync(absolutePath);
    if (imageType === 'png') {
      // IHDR: width/height are big-endian u32 at bytes 16..24
      if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50) {
        const width = buf.readUInt32BE(16);
        const height = buf.readUInt32BE(20);
        if (width > 0 && height > 0 && width < 10000 && height < 10000) {
          return { width, height };
        }
      }
    } else {
      const text = buf.toString('utf8');
      const viewBox = text.match(/viewBox\s*=\s*"([^"]+)"/i);
      if (viewBox) {
        const parts = viewBox[1].trim().split(/[\s,]+/).map(Number);
        if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
          return { width: Math.round(parts[2]), height: Math.round(parts[3]) };
        }
      }
      const w = text.match(/\bwidth\s*=\s*"([0-9.]+)"/i);
      const h = text.match(/\bheight\s*=\s*"([0-9.]+)"/i);
      if (w && h) {
        const width = Math.round(Number(w[1]));
        const height = Math.round(Number(h[1]));
        if (width > 0 && height > 0) return { width, height };
      }
    }
  } catch {
    // fall through
  }
  return fallback;
}

export function defaultPictureName(relativePath: string, explicit?: string): string {
  if (explicit?.trim()) return explicit.trim();
  return basename(relativePath, extname(relativePath));
}

/** Tiny 1×1 PNG used as Entry thumb when the costume is SVG-only. */
export const PLACEHOLDER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
