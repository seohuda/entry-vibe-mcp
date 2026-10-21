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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
import {
  getLibraryAttributions,
  getLibraryMedia,
  libraryMediaKey,
  LIBRARY_ASSET_PREFIX,
  parseLibraryAttributions,
  type LibraryAttribution,
} from './library-media.ts';

export interface PackOptions {
  /** Destination .ent path */
  outputPath: string;
  /** Directory containing entrybot1.svg / .png / bark.mp3 */
  mediaDir?: string;
  /** Keep intermediate staging dir for debugging */
  keepStaging?: boolean;
  /** Override file-id generator (tests). */
  createFileId?: () => string;
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

export type PendingLibraryPicture = {
  kind: 'picture';
  fileId: string;
  source: { type: 'library'; bytes: Buffer; imageType: ImageType; thumbnailBytes?: Buffer };
};

export type PendingLibrarySound = {
  kind: 'sound';
  fileId: string;
  source: { type: 'library'; bytes: Buffer };
};

export type PendingAsset =
  | PendingBuiltinPicture
  | PendingHostPicture
  | PendingBuiltinSound
  | PendingHostSound
  | PendingLibraryPicture
  | PendingLibrarySound;

/** Project JSON already rewritten to hash paths, plus the bytes still to stage. */
export interface PreparedExport {
  project: EntryProject;
  assets: PendingAsset[];
  /** Resource notices embedded beside project.json without changing Entry's schema. */
  libraryAttributions?: LibraryAttribution[];
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
  const generateFileId = options.createFileId ?? createFileId;
  const assets: PendingAsset[] = [];
  const usedFileIds = new Set<string>();
  const libraryIds = new Map<string, string>();
  const reserveFileId = (id: string): string => {
    if (!/^[0-9a-f]{32}$/.test(id)) throw new Error('media file ID must be 32 lowercase hexadecimal characters');
    if (usedFileIds.has(id)) throw new Error('duplicate media file ID');
    usedFileIds.add(id);
    return id;
  };
  const nextFileId = () => reserveFileId(generateFileId());
  const libraryAsset = (marker: string, kind: 'picture' | 'sound') => {
    const media = getLibraryMedia(project, marker);
    if (media.kind !== kind) throw new Error('library media type does not match its reference');
    const key = libraryMediaKey(media);
    let fileId = libraryIds.get(key);
    if (!fileId) {
      fileId = reserveFileId(key.slice(0, 32));
      libraryIds.set(key, fileId);
      if (media.kind === 'picture') {
        assets.push({ kind: 'picture', fileId, source: {
          type: 'library', bytes: Buffer.from(media.bytes), imageType: media.imageType,
          thumbnailBytes: media.thumbnailBytes ? Buffer.from(media.thumbnailBytes) : undefined,
        } });
      } else {
        assets.push({ kind: 'sound', fileId, source: { type: 'library', bytes: Buffer.from(media.bytes) } });
      }
    }
    return { fileId, media };
  };

  for (const obj of exportable.objects) {
    const sprite = obj.sprite as { pictures?: PictureAsset[]; sounds?: SoundAsset[] } | undefined;
    if (!sprite) continue;

    for (const picture of sprite.pictures ?? []) {
      if (picture.fileurl?.startsWith(LIBRARY_ASSET_PREFIX)) {
        const { fileId, media } = libraryAsset(picture.fileurl, 'picture');
        if (media.kind !== 'picture') throw new Error('invalid library picture reference');
        picture.filename = fileId;
        picture.imageType = media.imageType;
        picture.fileurl = hashFileUrl(fileId, 'image', media.imageType);
        picture.thumbUrl = hashFileUrl(fileId, 'thumb', 'png');
        continue;
      }
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
      if (sound.fileurl?.startsWith(LIBRARY_ASSET_PREFIX)) {
        const { fileId } = libraryAsset(sound.fileurl, 'sound');
        sound.filename = fileId;
        sound.ext = '.mp3';
        sound.fileurl = hashFileUrl(fileId, 'sound', 'mp3');
        continue;
      }
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

  const libraryAttributions = parseLibraryAttributions(getLibraryAttributions(project));
  return { project: exportable, assets, ...(libraryAttributions.length ? { libraryAttributions } : {}) };
}

/** Write hash-layout media files for a previously prepared export. */
export function writePendingAssets(
  assets: PendingAsset[],
  tempDir: string,
  mediaSource: string,
): void {
  // File IDs also determine archive directories; never accept caller-supplied paths.
  const ids = new Set<string>();
  for (const asset of assets) {
    if (!/^[0-9a-f]{32}$/.test(asset.fileId)) throw new Error('unsafe media file ID');
    if (ids.has(asset.fileId)) throw new Error('duplicate media file ID');
    ids.add(asset.fileId);
  }
  for (const asset of assets) {
    const dir = join(tempDir, subDir(asset.fileId));
    if (asset.kind === 'sound') {
      if (asset.source.type === 'library') {
        writeBinary(join(dir, 'sound', `${asset.fileId}.mp3`), asset.source.bytes);
      } else if (asset.source.type === 'builtin') {
        const mp3 = readFileSync(requireMedia(mediaSource, `${asset.source.stem}.mp3`));
        writeBinary(join(dir, 'sound', `${asset.fileId}.mp3`), mp3);
      } else {
        writeBinary(join(dir, 'sound', `${asset.fileId}.mp3`), readFileSync(asset.source.absolutePath));
      }
      continue;
    }

    if (asset.source.type === 'library') {
      const { bytes, imageType, thumbnailBytes } = asset.source;
      const thumbnail = imageType === 'png' ? bytes : thumbnailBytes;
      if (!thumbnail) throw new Error('library SVG requires a validated PNG thumbnail');
      writeBinary(join(dir, 'image', `${asset.fileId}.${imageType}`), bytes);
      writeBinary(join(dir, 'thumb', `${asset.fileId}.png`), thumbnail);
      if (imageType === 'svg') writeBinary(join(dir, 'image', `${asset.fileId}.png`), thumbnail);
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

  const mediaSource = options.mediaDir ?? mediaDir();
  const outputParent = dirname(outputPath);
  mkdirSync(outputParent, { recursive: true });

  const stagingRoot = mkdtempSync(join(outputParent, '.ent-staging-'));
  const tempDir = join(stagingRoot, 'temp');

  try {
    mkdirSync(tempDir, { recursive: true });
    writePendingAssets(prepared.assets, tempDir, mediaSource);
    writeFileSync(join(tempDir, 'project.json'), JSON.stringify(prepared.project), 'utf8');
    if (prepared.libraryAttributions?.length) {
      const notices = parseLibraryAttributions(prepared.libraryAttributions);
      writeFileSync(join(tempDir, 'library-attribution.json'),
        JSON.stringify({ version: 1, objects: notices }) + '\n', 'utf8');
    }

    await tar.c(
      {
        gzip: { level: 6 },
        file: outputPath,
        cwd: stagingRoot,
        portable: true,
      },
      ['temp'],
    );

    return outputPath;
  } finally {
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

export function writePreparedJson(prepared: PreparedExport, path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(prepared.project, null, 2) + '\n');
}
