/**
 * Pack an Entry project into a .ent file (tar.gz with temp/project.json + media).
 *
 * Asset layout matches playentry.org / entry-offline:
 *   temp/{ab}/{cd}/image/{fileId}.svg|.png
 *   temp/{ab}/{cd}/thumb/{fileId}.png
 *   temp/{ab}/{cd}/sound/{fileId}.mp3
 *
 * Built-in entrybot media comes from the package `assets/media/`.
 * Host costumes use `host-asset:…` markers set by the compiler from `assets/`.
 *
 * Use {@link prepareExport} once, then {@link writePreparedJson} + {@link packPrepared}
 * so the sidecar `.json` and the `.ent` share the same file ids.
 */
import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import * as tar from 'tar';
import { type EntryProject } from './skeleton.ts';
import { projectForExport } from './compile.ts';
import { mediaDir } from '../src/paths.ts';
import {
  PLACEHOLDER_PNG,
  parseHostAssetMarker,
  resolveHostAsset,
  resolveHostSound,
  siblingPngPath,
  type ImageType,
} from './assets.ts';

export interface PackOptions {
  /** Destination .ent path */
  outputPath: string;
  /** Directory containing entrybot1.svg / .png / bark.mp3 */
  mediaDir?: string;
  /** Keep intermediate staging dir for debugging */
  keepStaging?: boolean;
  /** Override file-id generator (tests). */
  createFileId?: () => string;
  overwrite?: boolean;
}

export type PictureStem = 'entrybot1' | 'entrybot2';
export type SoundStem = 'bark';

export type PendingBuiltinPicture = {
  kind: 'picture';
  fileId: string;
  source: { type: 'builtin'; stem: PictureStem };
};

export type PendingHostPicture = {
  kind: 'picture';
  fileId: string;
  source: { type: 'host'; absolutePath: string; imageType: ImageType };
};

export type PendingBuiltinSound = {
  kind: 'sound';
  fileId: string;
  source: { type: 'builtin'; stem: SoundStem };
};

export type PendingHostSound = {
  kind: 'sound';
  fileId: string;
  source: { type: 'host'; absolutePath: string };
};

export type PendingAsset =
  | PendingBuiltinPicture
  | PendingHostPicture
  | PendingBuiltinSound
  | PendingHostSound;

/** Project JSON already rewritten to hash paths, plus the bytes still to stage. */
export interface PreparedExport {
  project: EntryProject;
  assets: PendingAsset[];
}

/** Entry-style opaque file id (32 hex chars; first 4 drive the ab/cd folders). */
export function createFileId(): string {
  return randomBytes(16).toString('hex');
}

function subDir(fileId: string): string {
  return join(fileId.slice(0, 2), fileId.slice(2, 4));
}

function requireMedia(mediaSource: string, file: string): string {
  const src = join(mediaSource, file);
  if (!existsSync(src)) {
    throw new Error(
      `Missing media file: ${src}. It should ship in assets/media/; ` +
        'restore it from upstream with `npm run fetch:entryjs`.',
    );
  }
  return src;
}

function writeBinary(dest: string, bytes: Buffer): void {
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, bytes);
}

interface PictureAsset {
  id?: string;
  name?: string;
  fileurl?: string;
  thumbUrl?: string;
  filename?: string;
  imageType?: string;
  dimension?: { width: number; height: number };
  [key: string]: unknown;
}

interface SoundAsset {
  id?: string;
  name?: string;
  fileurl?: string;
  filename?: string;
  ext?: string;
  duration?: number;
  [key: string]: unknown;
}

function basenameFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const normalized = url.replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || undefined;
}

function pictureStemFromBasename(base: string | undefined): PictureStem | undefined {
  if (!base) return undefined;
  if (base.startsWith('entrybot1')) return 'entrybot1';
  if (base.startsWith('entrybot2')) return 'entrybot2';
  return undefined;
}

function soundStemFromBasename(base: string | undefined): SoundStem | undefined {
  if (!base) return undefined;
  if (base.startsWith('bark')) return 'bark';
  return undefined;
}

function hashFileUrl(fileId: string, kind: 'image' | 'thumb' | 'sound', ext: string): string {
  return `temp/${fileId.slice(0, 2)}/${fileId.slice(2, 4)}/${kind}/${fileId}.${ext}`;
}

/**
 * Clone + stringify scripts, then rewrite media markers into Entry hash-folder
 * `filename` / `fileurl` / `thumbUrl` fields.
 */
export function prepareExport(
  project: EntryProject,
  options: { createFileId?: () => string } = {},
): PreparedExport {
  const exportable = projectForExport(project);
  const nextFileId = options.createFileId ?? createFileId;
  const assets: PendingAsset[] = [];

  for (const obj of exportable.objects) {
    const sprite = obj.sprite as { pictures?: PictureAsset[]; sounds?: SoundAsset[] } | undefined;
    if (!sprite) continue;

    for (const picture of sprite.pictures ?? []) {
      const fileId = nextFileId();
      const hostRel = parseHostAssetMarker(picture.fileurl) ?? parseHostAssetMarker(picture.thumbUrl);

      if (hostRel) {
        const resolved = resolveHostAsset(hostRel);
        assets.push({
          kind: 'picture',
          fileId,
          source: {
            type: 'host',
            absolutePath: resolved.absolutePath,
            imageType: resolved.imageType,
          },
        });
        picture.filename = fileId;
        picture.imageType = resolved.imageType;
        picture.fileurl = hashFileUrl(fileId, 'image', resolved.imageType);
        picture.thumbUrl = hashFileUrl(fileId, 'thumb', 'png');
        continue;
      }

      const base = basenameFromUrl(picture.fileurl) ?? basenameFromUrl(picture.thumbUrl);
      const stem = pictureStemFromBasename(base);
      if (!stem) {
        throw new Error(
          `Cannot export picture ${JSON.stringify(picture.name ?? picture.id)}: ` +
            `unsupported or missing media (fileurl=${JSON.stringify(picture.fileurl)})`,
        );
      }

      assets.push({ kind: 'picture', fileId, source: { type: 'builtin', stem } });
      picture.filename = fileId;
      picture.imageType = picture.imageType ?? 'svg';
      picture.fileurl = hashFileUrl(fileId, 'image', 'svg');
      picture.thumbUrl = hashFileUrl(fileId, 'thumb', 'png');
    }

    for (const sound of sprite.sounds ?? []) {
      const fileId = nextFileId();
      const hostRel = parseHostAssetMarker(sound.fileurl);

      if (hostRel) {
        const resolved = resolveHostSound(hostRel);
        assets.push({
          kind: 'sound',
          fileId,
          source: { type: 'host', absolutePath: resolved.absolutePath },
        });
        sound.filename = fileId;
        sound.ext = sound.ext ?? '.mp3';
        sound.fileurl = hashFileUrl(fileId, 'sound', 'mp3');
        continue;
      }

      const base = basenameFromUrl(sound.fileurl) ?? 'bark.mp3';
      const stem = soundStemFromBasename(base);
      if (!stem) {
        throw new Error(
          `Cannot export sound ${JSON.stringify(sound.name ?? sound.id)}: ` +
            `unsupported or missing media (fileurl=${JSON.stringify(sound.fileurl)})`,
        );
      }

      assets.push({ kind: 'sound', fileId, source: { type: 'builtin', stem } });
      sound.filename = fileId;
      sound.ext = sound.ext ?? '.mp3';
      sound.fileurl = hashFileUrl(fileId, 'sound', 'mp3');
    }
  }

  return { project: exportable, assets };
}

/** Write hash-layout media files for a previously prepared export. */
export function writePendingAssets(
  assets: PendingAsset[],
  tempDir: string,
  mediaSource: string,
): void {
  for (const asset of assets) {
    const dir = join(tempDir, subDir(asset.fileId));
    if (asset.kind === 'sound') {
      if (asset.source.type === 'builtin') {
        const mp3 = readFileSync(requireMedia(mediaSource, `${asset.source.stem}.mp3`));
        writeBinary(join(dir, 'sound', `${asset.fileId}.mp3`), mp3);
      } else {
        writeBinary(join(dir, 'sound', `${asset.fileId}.mp3`), readFileSync(asset.source.absolutePath));
      }
      continue;
    }

    if (asset.source.type === 'builtin') {
      const svg = readFileSync(requireMedia(mediaSource, `${asset.source.stem}.svg`));
      const png = readFileSync(requireMedia(mediaSource, `${asset.source.stem}.png`));
      writeBinary(join(dir, 'image', `${asset.fileId}.svg`), svg);
      writeBinary(join(dir, 'image', `${asset.fileId}.png`), png);
      writeBinary(join(dir, 'thumb', `${asset.fileId}.png`), png);
      continue;
    }

    const bytes = readFileSync(asset.source.absolutePath);
    if (asset.source.imageType === 'svg') {
      writeBinary(join(dir, 'image', `${asset.fileId}.svg`), bytes);
      // Prefer a same-stem .png sibling for thumb (and raster image/); otherwise
      // fall back to a tiny placeholder so Entry still has a thumb file.
      const sibling = siblingPngPath(asset.source.absolutePath);
      const thumb = sibling ? readFileSync(sibling) : PLACEHOLDER_PNG;
      if (sibling) {
        writeBinary(join(dir, 'image', `${asset.fileId}.png`), thumb);
      }
      writeBinary(join(dir, 'thumb', `${asset.fileId}.png`), thumb);
    } else {
      writeBinary(join(dir, 'image', `${asset.fileId}.png`), bytes);
      writeBinary(join(dir, 'thumb', `${asset.fileId}.png`), bytes);
    }
  }
}

/** Pack an already-prepared export (same ids as a sidecar JSON). */
export async function packPrepared(
  prepared: PreparedExport,
  options: PackOptions,
): Promise<string> {
  const { outputPath } = options;
  if (!outputPath.endsWith('.ent')) {
    throw new Error('output path must end with .ent');
  }
  const overwrite = options.overwrite !== false;
  if (!overwrite && existsSync(outputPath)) {
    throw new Error(`refusing to overwrite existing file: ${outputPath}`);
  }

  const mediaSource = options.mediaDir ?? mediaDir();
  const outputParent = dirname(outputPath);
  mkdirSync(outputParent, { recursive: true });

  const stagingRoot = mkdtempSync(join(outputParent, '.ent-staging-'));
  const tempDir = join(stagingRoot, 'temp');
  const tempTar = join(outputParent, `.${basename(outputPath)}.tmp-${randomBytes(8).toString('hex')}`);

  try {
    mkdirSync(tempDir, { recursive: true });
    writePendingAssets(prepared.assets, tempDir, mediaSource);
    writeFileSync(join(tempDir, 'project.json'), JSON.stringify(prepared.project), 'utf8');

    await tar.c(
      {
        gzip: { level: 6 },
        file: tempTar,
        cwd: stagingRoot,
        portable: true,
      },
      ['temp'],
    );

    if (!overwrite && existsSync(outputPath)) {
      throw new Error(`refusing to overwrite existing file: ${outputPath}`);
    }
    renameSync(tempTar, outputPath);
    return outputPath;
  } finally {
    rmSync(tempTar, { force: true });
    if (!options.keepStaging) {
      rmSync(stagingRoot, { recursive: true, force: true });
    }
  }
}

export async function packEnt(
  project: EntryProject,
  options: PackOptions,
): Promise<string> {
  const prepared = prepareExport(project, { createFileId: options.createFileId });
  return packPrepared(prepared, options);
}

/** Write playentry-compatible project.json (hash media refs). Ids differ from a later packEnt unless you reuse {@link prepareExport}. */
export function writeProjectJson(
  project: EntryProject,
  path: string,
  options: { createFileId?: () => string } = {},
): void {
  const prepared = prepareExport(project, options);
  writePreparedJson(prepared, path);
}

export function writePreparedJson(
  prepared: PreparedExport,
  path: string,
  options: { overwrite?: boolean } = {},
): void {
  const overwrite = options.overwrite !== false;
  if (!overwrite && existsSync(path)) {
    throw new Error(`refusing to overwrite existing file: ${path}`);
  }
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = join(dirname(path), `.${basename(path)}.tmp-${randomBytes(8).toString('hex')}`);
  try {
    writeFileSync(tempPath, JSON.stringify(prepared.project, null, 2) + '\n');
    if (!overwrite && existsSync(path)) {
      throw new Error(`refusing to overwrite existing file: ${path}`);
    }
    renameSync(tempPath, path);
  } finally {
    rmSync(tempPath, { force: true });
  }
}

export interface PreparedOutputOptions {
  entPath: string;
  jsonPath: string;
  overwrite?: boolean;
  mediaDir?: string;
}

export async function writePreparedOutputs(
  prepared: PreparedExport,
  options: PreparedOutputOptions,
): Promise<{ entPath: string; jsonPath: string }> {
  const { entPath, jsonPath } = options;
  const overwrite = options.overwrite !== false;
  if (!overwrite) {
    const conflicts = [entPath, jsonPath].filter((path) => existsSync(path));
    if (conflicts.length > 0) {
      throw new Error(`refusing to overwrite existing file(s): ${conflicts.join(', ')}`);
    }
  }

  mkdirSync(dirname(entPath), { recursive: true });
  mkdirSync(dirname(jsonPath), { recursive: true });

  const nonce = randomBytes(8).toString('hex');
  const entStem = basename(entPath).replace(/\.ent$/i, '');
  const tempJson = join(dirname(jsonPath), `.${basename(jsonPath)}.tmp-${nonce}`);
  const tempEnt = join(dirname(entPath), `.${entStem}.tmp-${nonce}.ent`);
  const committed: Array<{ dest: string; backup?: string }> = [];

  try {
    writeFileSync(tempJson, JSON.stringify(prepared.project, null, 2) + '\n');
    await packPrepared(prepared, {
      outputPath: tempEnt,
      mediaDir: options.mediaDir,
      overwrite: true,
    });

    for (const [tempPath, dest] of [
      [tempJson, jsonPath],
      [tempEnt, entPath],
    ] as const) {
      let backup: string | undefined;
      if (existsSync(dest)) {
        backup = join(dirname(dest), `.${basename(dest)}.bak-${nonce}`);
        renameSync(dest, backup);
      }
      committed.push({ dest, backup });
      renameSync(tempPath, dest);
    }

    for (const { backup } of committed) {
      if (backup) rmSync(backup, { force: true });
    }
    return { entPath, jsonPath };
  } catch (err) {
    const rollbackErrors: string[] = [];
    for (const { dest, backup } of committed.reverse()) {
      rmSync(dest, { force: true });
      if (backup) {
        try {
          renameSync(backup, dest);
        } catch (restoreErr) {
          rollbackErrors.push(
            restoreErr instanceof Error ? restoreErr.message : String(restoreErr),
          );
        }
      }
    }
    if (rollbackErrors.length > 0) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`${message}; rollback also failed: ${rollbackErrors.join('; ')}`);
    }
    throw err;
  } finally {
    rmSync(tempJson, { force: true });
    rmSync(tempEnt, { force: true });
  }
}
