import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import {
  getObjectLibrary, LocalAssetLibraryProvider, MAX_LIBRARY_ASSET_BYTES,
  NativeEntryLibraryProvider, ObjectLibraryRegistry,
} from '../src/library/index.ts';
import { validateMp3, validatePng, validateSvg } from '../src/library/media.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PNG = readFileSync(join(ROOT, 'assets/library/media/cat-walk1.png'));
const MP3 = readFileSync(join(ROOT, 'assets/library/media/beep.mp3'));
const dirs: string[] = [];
function temp(): string { const dir = mkdtempSync(join(tmpdir(), 'entry-library-test-')); dirs.push(dir); return dir; }
function manifest(path = 'cat.png') {
  return { version: 1, objects: [{ id: 'hero', name: '고양이', aliases: ['cat'], category: 'animals', categoryName: '동물',
    license: { spdx: 'MIT', attribution: 'Test asset owner' }, costumes: [{ id: 'idle', name: '서 있기', path, format: 'png', width: 160, height: 160 }],
    sounds: [{ id: 'beep', name: '알림음', path: 'beep.mp3', format: 'mp3', duration: 0.444082 }] }] };
}
function provider(root = temp(), data: unknown = manifest()): LocalAssetLibraryProvider {
  writeFileSync(join(root, 'cat.png'), PNG); writeFileSync(join(root, 'beep.mp3'), MP3);
  return new LocalAssetLibraryProvider({ root, manifest: data, source: 'user' });
}
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('real offline object catalog', () => {
  it('searches Korean and English names, including whole Korean requests', () => {
    const library = getObjectLibrary();
    expect(library.searchObjects('고양이')[0].id).toBe('local:cat');
    expect(library.searchObjects('cat')[0].id).toBe('local:cat');
    expect(library.searchObjects('자동차 경주 게임 만들어줘. 자동차랑 장애물을 넣어.').map((object) => object.id)).toContain('local:car');
    expect(library.searchObjects('고양이랑 강아지 캐릭터로 대화 게임').map((object) => object.id)).toEqual(expect.arrayContaining(['local:cat', 'local:dog']));
    expect(library.searchObjects('nonexistent-abcxyz')).toEqual([]);
    expect(library.searchObjects('a')).toEqual([]);
    expect(library.searchObjects('개').map((object) => object.id)).toEqual(['local:dog']);
  });
  it('filters actual categories, providers, and enforces result bounds', () => {
    const library = getObjectLibrary();
    expect(library.searchObjects('', { category: 'animals' }).map((object) => object.id)).toEqual(['local:cat', 'local:dog']);
    expect(library.searchObjects('', { category: '동물', source: 'local', limit: 1 })).toHaveLength(1);
    expect(library.listCategories().find((category) => category.id === 'animals')).toMatchObject({ count: 2, source: 'local', name: '동물' });
    expect(() => library.searchObjects('', { limit: 51 })).toThrow(/limit/);
    expect(() => library.searchObjects('x'.repeat(513))).toThrow(/512/);
    expect(() => library.searchObjects('', { source: 'missing' })).toThrow(/unknown/);
  });
  it('reports native Entry integration unavailable, without contacting a service', () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network must not run'));
    const library = getObjectLibrary();
    expect(library.listProviders().find((item) => item.source === 'entry')).toMatchObject({ available: false });
    expect(() => library.searchObjects('cat', { source: 'entry' })).toThrow(/unavailable/);
    expect(() => library.getObject('entry:not-real')).toThrow(/unavailable/);
    const native = new NativeEntryLibraryProvider();
    expect(() => native.resolveObjectAssets('entry:not-real')).toThrow(/unavailable/);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects unresolved or malformed IDs and metadata mutation', () => {
    const library = getObjectLibrary();
    expect(() => library.getObject('local:missing')).toThrow(/unknown/);
    expect(() => library.getObject('cat')).toThrow(/qualified/);
    expect(() => library.getObject('local:../cat')).toThrow(/qualified/);
    const cat = library.getObject('local:cat'); cat.costumes[0].name = 'mutated';
    expect(library.getObject('local:cat').costumes[0].name).toBe('고양이_걷기1');
  });
  it('resolves real ordered costumes and usable sound metadata', () => {
    const resolved = getObjectLibrary().resolveObjectAssets('local:cat');
    expect(resolved.costumes.map((costume) => costume.name)).toEqual(['고양이_걷기1', '고양이_걷기2']);
    expect(resolved.costumes[0].dimension).toEqual({ width: 160, height: 160 });
    expect(resolved.costumes[0].bytes.equals(PNG)).toBe(true);
    expect(resolved.sounds[0]).toMatchObject({ name: '알림음', duration: 0.444082, ext: '.mp3' });
    expect(resolved.object.license.spdx).toBe('MIT');
    for (const object of getObjectLibrary().searchObjects('')) expect(getObjectLibrary().resolveObjectAssets(object.id).costumes.length).toBeGreaterThan(0);
  });
});

describe('user manifests and local asset boundary', () => {
  it('resolves user-provided resources with explicit attribution', () => {
    const local = provider();
    expect(local.getObject('user:hero').source).toBe('user');
    expect(local.resolveObjectAssets('user:hero').costumes[0].bytes.equals(PNG)).toBe(true);
    expect(local.resolveObjectAssets('user:hero').sounds[0].bytes.equals(MP3)).toBe(true);
  });
  it('loads an explicitly configured manifest confined to host assets', () => {
    const root = temp(); provider(root); writeFileSync(join(root, 'catalog.json'), JSON.stringify(manifest()));
    vi.stubEnv('ENTRY_VIBE_ASSETS_DIR', root); vi.stubEnv('ENTRY_VIBE_OBJECT_LIBRARY', 'assets/catalog.json');
    expect(getObjectLibrary().getObject('user:hero').name).toBe('고양이');
    vi.stubEnv('ENTRY_VIBE_OBJECT_LIBRARY', '../catalog.json');
    expect(() => getObjectLibrary()).toThrow(/traversal/);
  });
  it.each(['../cat.png', '/tmp/cat.png', 'folder/../../cat.png', 'folder\\cat.png', 'file:///tmp/cat.png', 'https://example.com/cat.png', 'http://127.0.0.1/cat.png', 'https://example.com/redirect-to-private.png', 'cat.png\0'])('rejects unsafe paths and URL fetches: %s', (path) => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('must never fetch'));
    expect(() => provider(undefined, manifest(path))).toThrow(); expect(fetch).not.toHaveBeenCalled();
  });
  it('fails immediately offline even if fetch never resolves (no network timeout dependency)', () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}));
    expect(() => provider(undefined, manifest('https://example.com/cat.png'))).toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects symlinks outside provider root', () => {
    const root = temp(), outside = temp(); writeFileSync(join(outside, 'cat.png'), PNG);
    const local = provider(root, manifest('escape.png')); symlinkSync(join(outside, 'cat.png'), join(root, 'escape.png'));
    expect(() => local.resolveObjectAssets('user:hero')).toThrow(/escapes/);
  });
  it('rejects missing, mismatched, corrupt and oversized files', () => {
    const root = temp(); const local = provider(root, manifest('missing.png'));
    expect(() => local.resolveObjectAssets('user:hero')).toThrow();
    const valid = provider(root); writeFileSync(join(root, 'cat.png'), Buffer.from('not an image'));
    expect(() => valid.resolveObjectAssets('user:hero')).toThrow(/PNG/);
    const corrupt = Buffer.from(PNG); corrupt[corrupt.length - 1] ^= 0xff; writeFileSync(join(root, 'cat.png'), corrupt);
    expect(() => valid.resolveObjectAssets('user:hero')).toThrow(/PNG/);
    writeFileSync(join(root, 'cat.png'), Buffer.alloc(MAX_LIBRARY_ASSET_BYTES + 1));
    expect(() => valid.resolveObjectAssets('user:hero')).toThrow(/regular file/);
    const bad = manifest('cat.svg');
    expect(() => provider(root, bad)).toThrow(/extension/);
  });
  it('rejects duplicate object/media identifiers, metadata dimensions and excessive catalogs', () => {
    const data = manifest(); data.objects.push(structuredClone(data.objects[0]));
    expect(() => provider(undefined, data)).toThrow(/duplicate library object/);
    const media = manifest(); media.objects[0].costumes.push(structuredClone(media.objects[0].costumes[0]));
    expect(() => provider(undefined, media)).toThrow(/duplicate media/);
    const dimensions = manifest(); dimensions.objects[0].costumes[0].width = 100;
    expect(() => provider(undefined, dimensions).resolveObjectAssets('user:hero')).toThrow(/dimension metadata/);
    expect(() => provider(undefined, { version: 1, objects: Array(257).fill(manifest().objects[0]) })).toThrow();
    expect(() => new ObjectLibraryRegistry([provider(), provider()])).toThrow(/duplicate/);
  });
  it('rejects a total asset budget overrun', () => {
    const data = manifest(); data.objects[0].sounds = Array.from({ length: 10 }, (_, index) => ({ id: `sound${index}`, name: 'tone', path: 'large.mp3', format: 'mp3', duration: 1 }));
    const root = temp(); const local = provider(root, data);
    // Valid complete MP3 frames, repeated until each file is about 4 MiB.
    const frame = Buffer.alloc(417); frame.set([0xff, 0xfb, 0x90, 0x00]);
    writeFileSync(join(root, 'large.mp3'), Buffer.concat(Array(10000).fill(frame)));
    expect(() => local.resolveObjectAssets('user:hero')).toThrow(/total asset budget/);
  });
});

describe('file signatures and safe SVG subset', () => {
  it('rejects truncated MP3 and invalid MP3 headers', () => {
    expect(() => validateMp3(Buffer.from([0xff, 0xfb, 0x90, 0]))).toThrow(/truncated/);
    expect(() => validateMp3(Buffer.from('ID3'))).toThrow(/ID3/);
    expect(() => validateMp3(MP3.subarray(0, MP3.length - 10))).toThrow(/truncated/);
    expect(() => validateMp3(MP3)).not.toThrow();
  });
  it('requires a real PNG thumbnail for user SVG costumes', () => {
    const data = manifest(); const costume = { ...data.objects[0].costumes[0], format: 'svg', path: 'cat.svg' };
    data.objects[0].costumes = [costume];
    expect(() => provider(undefined, data)).toThrow(/thumbnailPath/);
    const root = temp(); const local = provider(root, { ...data, objects: [{ ...data.objects[0], costumes: [{ ...costume, thumbnailPath: 'cat.png' }] }] });
    writeFileSync(join(root, 'cat.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><circle cx="80" cy="80" r="50" fill="red"/></svg>');
    const result = local.resolveObjectAssets('user:hero'); expect(result.costumes[0].thumbnailBytes?.equals(PNG)).toBe(true);
  });
  it.each([
    '<script>alert(1)</script>', '<image href="https://example.com/x"/>', '<foreignObject/>',
    '<rect fill="&#117;rl(https://example.com/x)"/>', '<rect fill="u\\72l(https://example.com/x)"/>',
    '<rect onload="alert(1)"/>', '<rect style="fill:url(https://example.com/x)"/>',
  ])('rejects active/external SVG content %s', (body) => {
    expect(() => validateSvg(Buffer.from(`<svg width="160" height="160">${body}</svg>`))).toThrow();
  });
  it.each([
    '<svg viewBox="0 0 10 10"><g></svg>',
    '<svg viewBox="0 0 10 10"><g id="open></g></svg>',
    '<svg viewBox="0 0 10 10"><g id=unquoted></g></svg>',
    '<svg viewBox="0 0 10 10"><g id="a"id="b"/></svg>',
    '<svg viewBox="0 0 10 10"><g id="a" id="b"/></svg>',
    '<svg viewBox="0 0 10 10"><g / ></svg>',
    '<svg viewBox="0 0 10 10"></svg><svg viewBox="0 0 10 10"></svg>',
    '<svg viewBox="0 0 10 10"><g></g>',
    '<svg viewBox="0 0 10 10"></g></svg>',
    '<svg viewBox="0 0 10 10"><g bad:attribute="a"/></svg>',
  ])('rejects malformed SVG XML %s', (text) => {
    expect(() => validateSvg(Buffer.from(text))).toThrow();
  });
  it('accepts balanced safe SVG with both quote styles and self-closing shapes', () => {
    expect(validateSvg(Buffer.from(`<svg viewBox="0 0 10 10"><g id='shapes'><circle cx="5" cy="5" r="4"/><title>A safe title</title></g></svg>`)))
      .toEqual({ width: 10, height: 10 });
  });
  it('rejects invalid PNG header and inflated data even with valid checksums', () => {
    function crc32(bytes: Buffer): number { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; }
    function chunk(type: string, data: Buffer): Buffer { const output = Buffer.alloc(data.length + 12); output.writeUInt32BE(data.length); output.write(type, 4); data.copy(output, 8); output.writeUInt32BE(crc32(output.subarray(4, output.length - 4)), output.length - 4); return output; }
    const header = Buffer.from('00000001000000010806000000', 'hex');
    const png = (raw: Buffer, ihdr = header) => Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
    expect(() => validatePng(png(Buffer.from([0, 255, 0, 0, 255])))).not.toThrow();
    expect(() => validatePng(png(Buffer.from([0])))).toThrow(/image data/);
    expect(() => validatePng(png(Buffer.from([5, 255, 0, 0, 255])))).toThrow(/image data/);
    const invalid = Buffer.from(header); invalid[8] = 7;
    expect(() => validatePng(png(Buffer.from([0, 255, 0, 0, 255]), invalid))).toThrow(/header/);
  });
});
