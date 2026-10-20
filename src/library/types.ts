/** Provider-neutral, synchronous catalog contract. IDs are qualified as source:id. */
export interface LibraryLicense {
  spdx: string;
  attribution: string;
  /** Optional full notice included with exported projects. */
  text?: string;
  url?: string;
}
export interface LibraryCostume {
  id: string;
  name: string;
  /** Provider-root-relative location; never a URL. */
  path: string;
  format: 'png' | 'svg';
  width?: number;
  height?: number;
  /** SVG costumes require an actual PNG thumbnail. */
  thumbnailPath?: string;
}
export interface LibrarySound {
  id: string;
  name: string;
  path: string;
  format: 'mp3';
  duration: number;
}
export interface LibraryObject {
  id: string;
  source: string;
  name: string;
  aliases: string[];
  category: string;
  categoryName: string;
  description?: string;
  kind: 'sprite' | 'background';
  costumes: LibraryCostume[];
  sounds: LibrarySound[];
  thumbnail?: { path: string; format: 'png'; width?: number; height?: number };
  license: LibraryLicense;
}
export interface LibraryCategory { id: string; name: string; source: string; count: number }
export interface LibraryProviderInfo { source: string; name: string; available: boolean; reason?: string }
export interface SearchObjectOptions { category?: string; limit?: number; source?: string }
export interface ResolvedLibraryCostume {
  id: string;
  name: string;
  bytes: Buffer;
  imageType: 'png' | 'svg';
  dimension: { width: number; height: number };
  thumbnailBytes?: Buffer;
}
export interface ResolvedLibrarySound {
  id: string;
  name: string;
  bytes: Buffer;
  duration: number;
  ext: '.mp3';
}
export interface ResolvedLibraryObject {
  object: LibraryObject;
  costumes: ResolvedLibraryCostume[];
  sounds: ResolvedLibrarySound[];
}
export interface ObjectLibraryProvider {
  readonly source: string;
  readonly info: LibraryProviderInfo;
  searchObjects(query: string, options?: SearchObjectOptions): LibraryObject[];
  getObject(objectId: string): LibraryObject;
  listCategories(): LibraryCategory[];
  resolveObjectAssets(objectId: string): ResolvedLibraryObject;
}
