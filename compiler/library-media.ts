/** Binary media stays outside project JSON until prepareExport embeds it in .ent. */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { EntryProject } from './skeleton.ts';
import type { EntryIRObject, IRAssetAttribution } from '../src/types/ir.ts';
import { getObjectLibrary, MAX_LIBRARY_PROJECT_BYTES, type ResolvedLibraryObject } from '../src/library/index.ts';

export type LibraryMedia =
  | { kind: 'picture'; bytes: Buffer; imageType: 'png' | 'svg'; thumbnailBytes?: Buffer }
  | { kind: 'sound'; bytes: Buffer };

export const LIBRARY_ASSET_PREFIX = 'library-asset:';
/** Bounds all unique library media held by one compiled project. */
export const MAX_PROJECT_LIBRARY_BYTES = MAX_LIBRARY_PROJECT_BYTES;

const projectMedia = new WeakMap<EntryProject, Map<string, LibraryMedia>>();
export type LibraryAttribution = IRAssetAttribution;
const projectAttributions = new WeakMap<EntryProject, Map<string, LibraryAttribution>>();

export const MAX_LIBRARY_ATTRIBUTION_BYTES = 2 * 1024 * 1024;
export const libraryAttributionsSchema = z.array(z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,31}:[a-z0-9][a-z0-9_-]{0,79}$/),
  source: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
  name: z.string().trim().min(1).max(200),
  license: z.object({
    spdx: z.string().trim().min(1).max(200),
    attribution: z.string().trim().min(1).max(2000),
    url: z.string().url().max(2000).refine((url) => /^https?:\/\//.test(url), 'license URL must use HTTP(S)').optional(),
    text: z.string().max(32768).optional(),
  }).strict(),
}).strict()).max(256).superRefine((entries, ctx) => {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (entry.id.split(':')[0] !== entry.source || ids.has(entry.id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'duplicate or mismatched attribution identifier' });
    }
    ids.add(entry.id);
  }
  if (Buffer.byteLength(JSON.stringify({ version: 1, objects: entries }) + '\n') > MAX_LIBRARY_ATTRIBUTION_BYTES) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'library attributions exceed 2 MiB' });
  }
});

export function parseLibraryAttributions(value: unknown): LibraryAttribution[] {
  return libraryAttributionsSchema.parse(value);
}

export function addLibraryAttribution(project: EntryProject, object: LibraryAttribution): void {
  let entries = projectAttributions.get(project);
  if (!entries) { entries = new Map(); projectAttributions.set(project, entries); }
  entries.set(object.id, structuredClone({ id: object.id, source: object.source, name: object.name, license: object.license }));
}

export function getLibraryAttributions(project: EntryProject): LibraryAttribution[] {
  return structuredClone([...(projectAttributions.get(project)?.values() ?? [])]
    .sort((a, b) => a.id.localeCompare(b.id, 'en')));
}

export interface LibraryResolutionContext {
  objects: Map<string, ResolvedLibraryObject>;
  media: Map<string, LibraryMedia>;
  totalBytes: number;
}

export function createLibraryResolutionContext(): LibraryResolutionContext {
  return { objects: new Map(), media: new Map(), totalBytes: 0 };
}

/** Reject ambiguous representations even when compileProject runs with strict:false. */
export function resolveIRLibraryObject(obj: EntryIRObject, context?: LibraryResolutionContext) {
  if (obj.sprite !== 'library') {
    if (obj.library !== undefined) throw new Error('library requires sprite: "library"');
    return undefined;
  }
  if (obj.kind === 'text') throw new Error('text objects cannot use library sprites');
  const ref = obj.library;
  if (!ref || typeof ref.source !== 'string' || !ref.source || typeof ref.objectId !== 'string' || !ref.objectId) {
    throw new Error('library requires source and a qualified objectId from search_objects');
  }
  if (obj.pictures !== undefined || obj.sounds !== undefined) {
    throw new Error('library costumes and sounds come from the provider; omit pictures/sounds');
  }
  let resolved = context?.objects.get(ref.objectId) ?? getObjectLibrary().resolveObjectAssets(ref.objectId);
  if (resolved.object.source !== ref.source) throw new Error('library.source does not match the object provider');
  if (resolved.costumes.length === 0) throw new Error('library object has no usable costumes');
  if (context && !context.objects.has(ref.objectId)) {
    const media: LibraryMedia[] = [
      ...resolved.costumes.map((picture): LibraryMedia => ({
        kind: 'picture', bytes: picture.bytes, imageType: picture.imageType,
        thumbnailBytes: picture.thumbnailBytes,
      })),
      ...resolved.sounds.map((sound): LibraryMedia => ({ kind: 'sound', bytes: sound.bytes })),
    ];
    const pending = new Map<string, LibraryMedia>();
    let extraBytes = 0;
    const canonical = media.map((item) => {
      const key = libraryMediaKey(item);
      const existing = context.media.get(key) ?? pending.get(key);
      if (!existing) {
        pending.set(key, item);
        extraBytes += mediaSize(item);
      }
      return existing ?? item;
    });
    if (context.totalBytes + extraBytes > MAX_PROJECT_LIBRARY_BYTES) {
      throw new Error('library media exceeds the 64 MiB project budget');
    }
    context.totalBytes += extraBytes;
    for (const [key, item] of pending) context.media.set(key, item);
    // Different catalog IDs can point at identical files. Retain one Buffer per
    // content key, rather than charging once while accidentally holding N copies.
    resolved = {
      ...resolved,
      costumes: resolved.costumes.map((picture, i) => {
        const bytes = canonical[i];
        if (bytes.kind !== 'picture') throw new Error('invalid library costume');
        return { ...picture, bytes: bytes.bytes, thumbnailBytes: bytes.thumbnailBytes };
      }),
      sounds: resolved.sounds.map((sound, i) => ({
        ...sound, bytes: canonical[resolved.costumes.length + i].bytes,
      })),
    };
    context.objects.set(ref.objectId, resolved);
  }
  return resolved;
}

export function libraryMediaKey(media: LibraryMedia): string {
  const format = media.kind === 'picture' ? media.imageType : 'mp3';
  const hash = createHash('sha256').update(`${media.kind}:${format}\0`).update(media.bytes);
  if (media.kind === 'picture' && media.thumbnailBytes) hash.update('\0thumbnail\0').update(media.thumbnailBytes);
  return hash.digest('hex');
}

function mediaSize(media: LibraryMedia): number {
  return media.bytes.length + (media.kind === 'picture' ? media.thumbnailBytes?.length ?? 0 : 0);
}

export function addLibraryMedia(project: EntryProject, media: LibraryMedia): string {
  const key = libraryMediaKey(media);
  let assets = projectMedia.get(project);
  if (!assets) {
    assets = new Map();
    projectMedia.set(project, assets);
  }
  if (!assets.has(key)) {
    const total = [...assets.values()].reduce((sum, item) => sum + mediaSize(item), 0);
    if (total + mediaSize(media) > MAX_PROJECT_LIBRARY_BYTES) {
      throw new Error('library media exceeds the 64 MiB project budget');
    }
    assets.set(key, {
      ...media,
      bytes: Buffer.from(media.bytes),
      ...(media.kind === 'picture' && media.thumbnailBytes ? { thumbnailBytes: Buffer.from(media.thumbnailBytes) } : {}),
    });
  }
  return `${LIBRARY_ASSET_PREFIX}${key}`;
}

export function getLibraryMedia(project: EntryProject, marker: string): LibraryMedia {
  const key = marker.slice(LIBRARY_ASSET_PREFIX.length);
  const media = projectMedia.get(project)?.get(key);
  if (!marker.startsWith(LIBRARY_ASSET_PREFIX) || !media) {
    throw new Error('library media bytes are missing; compile the EntryIR before exporting');
  }
  return media;
}

export function copyLibraryMedia(source: EntryProject, target: EntryProject): void {
  const assets = projectMedia.get(source);
  if (assets) projectMedia.set(target, assets);
  const attributions = projectAttributions.get(source);
  if (attributions) projectAttributions.set(target, attributions);
}
