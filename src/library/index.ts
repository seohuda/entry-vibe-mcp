/**
 * Offline object catalog. Native Entry service discovery is intentionally disabled:
 * EntryJS's editor loader is not a documented, stable redistribution API.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { findPackageRoot } from '../paths.ts';
import {
  checkMediaExtension, MAX_LIBRARY_MANIFEST_BYTES, MAX_LIBRARY_OBJECT_BYTES,
  readLibraryFile, safeLibraryPath, validateMp3, validatePng, validateSvg,
} from './media.ts';
import type {
  LibraryCategory, LibraryObject, LibraryProviderInfo, ObjectLibraryProvider,
  ResolvedLibraryObject, SearchObjectOptions,
} from './types.ts';
export * from './types.ts';
export {
  MAX_LIBRARY_ASSET_BYTES, MAX_LIBRARY_OBJECT_BYTES, MAX_LIBRARY_PROJECT_BYTES,
  MAX_LIBRARY_MANIFEST_BYTES,
} from './media.ts';

const idSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/);
const label = z.string().trim().min(1).max(200);
const pathSchema = z.string().min(1).max(512).superRefine((path, ctx) => {
  if (path.includes('\0') || path.includes('\\') || path.startsWith('/') ||
      /^[a-z][a-z0-9+.-]*:/i.test(path) || path.split('/').some((part) => !part || part === '..' || part === '.')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'must be a provider-relative path, without traversal or URLs' });
  }
});
const imageSchema = z.object({
  id: idSchema, name: label, path: pathSchema, format: z.enum(['png', 'svg']),
  width: z.number().positive().max(4096).optional(), height: z.number().positive().max(4096).optional(),
  thumbnailPath: pathSchema.optional(),
}).strict().superRefine((picture, ctx) => {
  if (picture.format === 'svg' && !picture.thumbnailPath) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'SVG costume requires a real PNG thumbnailPath' });
  }
});
const soundSchema = z.object({
  id: idSchema, name: label, path: pathSchema, format: z.literal('mp3'),
  duration: z.number().positive().max(86400),
}).strict();
const objectSchema = z.object({
  id: idSchema, name: label, aliases: z.array(label).max(50).default([]),
  category: idSchema, categoryName: label.optional(), description: z.string().max(2000).optional(),
  kind: z.enum(['sprite', 'background']).default('sprite'),
  costumes: z.array(imageSchema).min(1).max(64), sounds: z.array(soundSchema).max(32).default([]),
  license: z.object({
    spdx: label, attribution: z.string().trim().min(1).max(2000),
    text: z.string().trim().min(1).max(32768).optional(),
    url: z.string().url().max(2000).refine((url) => /^https?:\/\//.test(url), 'license URL must use HTTP(S)').optional(),
  }).strict(),
}).strict();
const manifestSchema = z.object({ version: z.literal(1), objects: z.array(objectSchema).min(1).max(256) }).strict();
export type LocalLibraryManifest = z.input<typeof manifestSchema>;

function normalized(value: string): string { return value.normalize('NFKC').trim().toLocaleLowerCase('en'); }
function limitFor(options: SearchObjectOptions): number {
  const limit = options.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('object search limit must be an integer from 1 to 50');
  return limit;
}
function queryFor(query: string): string {
  if (typeof query !== 'string' || query.length > 512) throw new Error('object search query must be a string of at most 512 characters');
  return normalized(query);
}
function score(object: LibraryObject, query: string): number {
  if (!query) return 1;
  const terms = [object.name, ...object.aliases].map(normalized);
  let rank = 0;
  for (const term of terms) {
    if (query === term) rank = Math.max(rank, 100);
    else if (query.length >= 2 && term.includes(query)) rank = Math.max(rank, 70);
    else if (term.length >= 2 && (/^[a-z0-9 -]+$/.test(term)
      ? (` ${query.replace(/[^a-z0-9]+/g, ' ')} `).includes(` ${term} `)
      : query.includes(term))) rank = Math.max(rank, 50);
  }
  if ([object.category, object.categoryName].some((value) => normalized(value) === query)) rank = Math.max(rank, 30);
  // Match actual descriptive words, never synthesize semantic associations.
  const words = query.split(/[\s,!?]+/).filter((word) => word.length >= 2);
  const description = normalized(object.description ?? '');
  if (words.some((word) => description.includes(word))) rank = Math.max(rank, 10);
  return rank;
}
function search(catalog: LibraryObject[], query: string, options: SearchObjectOptions): LibraryObject[] {
  const q = queryFor(query), limit = limitFor(options), category = normalized(options.category ?? '');
  return catalog.filter((object) => !category || [object.category, object.categoryName].some((value) => normalized(value) === category))
    .map((object) => ({ object, rank: score(object, q) })).filter(({ rank }) => rank > 0)
    .sort((a, b) => b.rank - a.rank || a.object.id.localeCompare(b.object.id, 'en'))
    .slice(0, limit).map(({ object }) => structuredClone(object));
}

/** Local manifests must contain only resources the owner is entitled to use. */
export class LocalAssetLibraryProvider implements ObjectLibraryProvider {
  readonly source: string;
  readonly info: LibraryProviderInfo;
  private readonly objects: LibraryObject[];
  private readonly root: string;
  constructor(options: { root: string; manifest: unknown; source?: string; name?: string }) {
    this.source = options.source ?? 'local';
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(this.source) || this.source === 'entry') throw new Error('invalid local provider source');
    this.info = { source: this.source, name: options.name ?? 'Local asset library', available: true };
    this.root = options.root;
    const manifest = manifestSchema.parse(options.manifest);
    const used = new Set<string>();
    const categories = new Map<string, string>();
    this.objects = manifest.objects.map((entry) => {
      if (used.has(entry.id)) throw new Error(`duplicate library object identifier: ${entry.id}`);
      used.add(entry.id);
      const mediaIds = new Set<string>();
      for (const item of [...entry.costumes, ...entry.sounds]) {
        if (mediaIds.has(item.id)) throw new Error(`duplicate media identifier in ${entry.id}: ${item.id}`);
        mediaIds.add(item.id);
        checkMediaExtension(item.path, item.format);
      }
      for (const picture of entry.costumes) {
        if (picture.thumbnailPath) checkMediaExtension(picture.thumbnailPath, 'png');
      }
      const categoryName = entry.categoryName ?? entry.category;
      if (categories.has(entry.category) && categories.get(entry.category) !== categoryName) throw new Error('inconsistent library category name');
      categories.set(entry.category, categoryName);
      const first = entry.costumes[0];
      return {
        ...entry, id: `${this.source}:${entry.id}`, source: this.source, categoryName,
        thumbnail: {
          path: first.thumbnailPath ?? first.path, format: 'png' as const,
          width: first.width, height: first.height,
        },
      };
    });
  }
  searchObjects(query: string, options: SearchObjectOptions = {}): LibraryObject[] {
    if (options.source && options.source !== this.source) return [];
    return search(this.objects, query, options);
  }
  getObject(objectId: string): LibraryObject {
    const object = this.objects.find((object) => object.id === objectId);
    if (!object) throw new Error(`unknown library object identifier: ${objectId}`);
    return structuredClone(object);
  }
  listCategories(): LibraryCategory[] {
    const groups = new Map<string, LibraryCategory>();
    for (const object of this.objects) {
      const group = groups.get(object.category) ?? { id: object.category, name: object.categoryName, source: this.source, count: 0 };
      group.count++; groups.set(group.id, group);
    }
    return [...groups.values()].sort((a, b) => a.id.localeCompare(b.id, 'en'));
  }
  resolveObjectAssets(objectId: string): ResolvedLibraryObject {
    const object = this.getObject(objectId);
    let total = 0;
    const read = (path: string): Buffer => {
      const bytes = readLibraryFile(this.root, path);
      total += bytes.length;
      if (total > MAX_LIBRARY_OBJECT_BYTES) throw new Error('library object exceeds total asset budget');
      return bytes;
    };
    const costumes = object.costumes.map((costume) => {
      const bytes = read(costume.path);
      const dimension = costume.format === 'png' ? validatePng(bytes) : validateSvg(bytes);
      if ((costume.width !== undefined && costume.width !== dimension.width) ||
          (costume.height !== undefined && costume.height !== dimension.height)) throw new Error('library costume dimension metadata disagrees with image');
      let thumbnailBytes: Buffer | undefined;
      if (costume.thumbnailPath) { thumbnailBytes = read(costume.thumbnailPath); validatePng(thumbnailBytes); }
      return { id: costume.id, name: costume.name, bytes, imageType: costume.format, dimension, thumbnailBytes };
    });
    const sounds = object.sounds.map((sound) => {
      const bytes = read(sound.path); validateMp3(bytes);
      return { id: sound.id, name: sound.name, bytes, duration: sound.duration, ext: '.mp3' as const };
    });
    return { object, costumes, sounds };
  }
}

const NATIVE_REASON = '공식 Entry 객체 카탈로그의 안정적인 공개 API와 자산 재배포 허용 범위를 확인하지 못했습니다. local 공급원 또는 권한이 있는 user 자산을 사용하세요.';
/** Honest capability placeholder; never accesses undocumented Entry services. */
export class NativeEntryLibraryProvider implements ObjectLibraryProvider {
  readonly source = 'entry';
  readonly info = { source: 'entry', name: 'Native Entry library (unsupported)', available: false, reason: NATIVE_REASON };
  private unsupported(): never { throw new Error(`native Entry library unavailable: ${NATIVE_REASON}`); }
  searchObjects(_query: string, _options?: SearchObjectOptions): LibraryObject[] { return this.unsupported(); }
  getObject(_objectId: string): LibraryObject { return this.unsupported(); }
  listCategories(): LibraryCategory[] { return this.unsupported(); }
  resolveObjectAssets(_objectId: string): ResolvedLibraryObject { return this.unsupported(); }
}
export class ObjectLibraryRegistry {
  private readonly providers: ObjectLibraryProvider[];
  constructor(providers: ObjectLibraryProvider[]) {
    if (providers.length > 16 || new Set(providers.map((provider) => provider.source)).size !== providers.length) throw new Error('duplicate or excessive object library providers');
    this.providers = [...providers];
  }
  private provider(source: string): ObjectLibraryProvider {
    const provider = this.providers.find((provider) => provider.source === source);
    if (!provider) throw new Error(`unknown object library source: ${source}`);
    if (!provider.info.available) throw new Error(`object library ${source} unavailable: ${provider.info.reason}`);
    return provider;
  }
  private providerForId(objectId: string): ObjectLibraryProvider {
    if (typeof objectId !== 'string' || !/^[a-z][a-z0-9-]{0,31}:[a-z0-9][a-z0-9_-]{0,79}$/.test(objectId)) throw new Error('library object identifier must be a qualified source:id');
    return this.provider(objectId.split(':')[0]);
  }
  listProviders(): LibraryProviderInfo[] { return this.providers.map((provider) => ({ ...provider.info })); }
  searchObjects(query: string, options: SearchObjectOptions = {}): LibraryObject[] {
    const limit = limitFor(options); queryFor(query);
    const providers = options.source ? [this.provider(options.source)] : this.providers.filter((provider) => provider.info.available);
    const objects = providers.flatMap((provider) => provider.searchObjects(query, { ...options, limit: 50 }));
    return search(objects, query, { ...options, limit });
  }
  getObject(objectId: string): LibraryObject { return this.providerForId(objectId).getObject(objectId); }
  listCategories(source?: string): LibraryCategory[] {
    return (source ? [this.provider(source)] : this.providers.filter((provider) => provider.info.available)).flatMap((provider) => provider.listCategories());
  }
  resolveObjectAssets(objectId: string): ResolvedLibraryObject { return this.providerForId(objectId).resolveObjectAssets(objectId); }
}

let builtin: LocalAssetLibraryProvider | undefined;
/** No media byte cache; one bounded built-in metadata snapshot and fresh user metadata per call. */
export function getObjectLibrary(): ObjectLibraryRegistry {
  if (!builtin) {
    const packageRoot = findPackageRoot();
    const root = [join(packageRoot, 'assets', 'library'), join(packageRoot, '..', 'assets', 'library')]
      .find((candidate) => existsSync(join(candidate, 'catalog.json')));
    if (!root) throw new Error('bundled local object library catalog missing');
    const manifest = JSON.parse(readLibraryFile(root, 'catalog.json', MAX_LIBRARY_MANIFEST_BYTES).toString('utf8')) as unknown;
    builtin = new LocalAssetLibraryProvider({ root, manifest, source: 'local', name: 'EntryVibe original local assets (MIT)' });
  }
  const providers: ObjectLibraryProvider[] = [builtin, new NativeEntryLibraryProvider()];
  if (process.env.ENTRY_VIBE_OBJECT_LIBRARY) {
    const assetsRoot = process.env.ENTRY_VIBE_ASSETS_DIR ?? join(process.cwd(), 'assets');
    const configured = process.env.ENTRY_VIBE_OBJECT_LIBRARY;
    const manifestPath = configured.startsWith('assets/') ? configured.slice(7) : configured;
    // All paths, including the manifest itself, stay inside the configured host assets root.
    safeLibraryPath(assetsRoot, manifestPath);
    const manifest = JSON.parse(readLibraryFile(assetsRoot, manifestPath, MAX_LIBRARY_MANIFEST_BYTES).toString('utf8')) as unknown;
    providers.push(new LocalAssetLibraryProvider({ root: assetsRoot, manifest, source: 'user', name: 'User-provided local assets' }));
  }
  return new ObjectLibraryRegistry(providers);
}
