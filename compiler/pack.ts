/**
 * Pack an Entry project into a .ent file (tar.gz with temp/project.json + media).
 *
 * Asset layout matches playentry.org / entry-offline:
 *   temp/{ab}/{cd}/image/{fileId}.svg|.png
 *   temp/{ab}/{cd}/thumb/{fileId}.png
 *   temp/{ab}/{cd}/sound/{fileId}.mp3
 *
 * Pictures/sounds get a `filename` (fileId) so Entry can resolve uploads paths;
 * `fileurl`/`thumbUrl` also point at the temp/ paths so Entry Offline remapping works.
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

export type PendingPictureAsset = {
  kind: 'picture';
  fileId: string;
  stem: PictureStem;
};

export type PendingSoundAsset = {
  kind: 'sound';
  fileId: string;
  stem: SoundStem;
};

export type PendingAsset = PendingPictureAsset | PendingSoundAsset;

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
 * Clone + stringify scripts, then rewrite skeleton `temp/media/…` markers into
 * Entry hash-folder `filename` / `fileurl` / `thumbUrl` fields.
 * Does not write any bytes — pair with {@link writePendingAssets}.
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
      const base = basenameFromUrl(picture.fileurl) ?? basenameFromUrl(picture.thumbUrl);
      const stem = pictureStemFromBasename(base);
      if (!stem) {
        throw new Error(
          `Cannot export picture ${JSON.stringify(picture.name ?? picture.id)}: ` +
            `unsupported or missing media (fileurl=${JSON.stringify(picture.fileurl)})`,
        );
      }

      const fileId = nextFileId();
      assets.push({ kind: 'picture', fileId, stem });
      picture.filename = fileId;
      picture.imageType = picture.imageType ?? 'svg';
      picture.fileurl = hashFileUrl(fileId, 'image', 'svg');
      picture.thumbUrl = hashFileUrl(fileId, 'thumb', 'png');
    }

    for (const sound of sprite.sounds ?? []) {
      const base = basenameFromUrl(sound.fileurl) ?? 'bark.mp3';
      const stem = soundStemFromBasename(base);
      if (!stem) {
        throw new Error(
          `Cannot export sound ${JSON.stringify(sound.name ?? sound.id)}: ` +
            `unsupported or missing media (fileurl=${JSON.stringify(sound.fileurl)})`,
        );
      }

      const fileId = nextFileId();
      assets.push({ kind: 'sound', fileId, stem });
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
    if (asset.kind === 'picture') {
      const svg = readFileSync(requireMedia(mediaSource, `${asset.stem}.svg`));
      const png = readFileSync(requireMedia(mediaSource, `${asset.stem}.png`));
      writeBinary(join(dir, 'image', `${asset.fileId}.svg`), svg);
      writeBinary(join(dir, 'image', `${asset.fileId}.png`), png);
      writeBinary(join(dir, 'thumb', `${asset.fileId}.png`), png);
    } else {
      const mp3 = readFileSync(requireMedia(mediaSource, `${asset.stem}.mp3`));
      writeBinary(join(dir, 'sound', `${asset.fileId}.mp3`), mp3);
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

    await tar.c(
      {
        gzip: { level: 6, memLevel: 6 },
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
