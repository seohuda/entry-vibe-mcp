/** Strict local media validation. This provider deliberately has no network client. */
import { closeSync, fstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { inflateSync } from 'node:zlib';

export const MAX_LIBRARY_ASSET_BYTES = 8 * 1024 * 1024;
export const MAX_LIBRARY_OBJECT_BYTES = 32 * 1024 * 1024;
export const MAX_LIBRARY_PROJECT_BYTES = 64 * 1024 * 1024;
export const MAX_LIBRARY_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_DIMENSION = 4096;

export function safeLibraryPath(root: string, path: string): string {
  if (typeof path !== 'string' || !path || path.includes('\0') || path.includes('\\') ||
      isAbsolute(path) || /^[a-z][a-z0-9+.-]*:/i.test(path) || path.split('/').some((p) => p === '..' || p === '.' || !p)) {
    throw new Error('library asset path must be relative, without traversal or URLs');
  }
  const realRoot = realpathSync(root);
  const file = realpathSync(resolve(realRoot, path));
  const rel = relative(realRoot, file);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error('library asset path escapes provider root');
  }
  return file;
}

/** Bounded descriptor reads avoid unbounded readFileSync allocation and reject devices. */
export function readLibraryFile(root: string, path: string, maxBytes = MAX_LIBRARY_ASSET_BYTES): Buffer {
  const file = safeLibraryPath(root, path);
  const fd = openSync(file, 'r');
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size < 1 || stat.size > maxBytes) {
      throw new Error(`library file must be a regular file of 1..${maxBytes} bytes`);
    }
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (!count) throw new Error('library file changed during read');
      offset += count;
    }
    if (readSync(fd, Buffer.alloc(1), 0, 1, offset) !== 0) throw new Error('library file changed during read');
    return bytes;
  } finally { closeSync(fd); }
}

function dimension(width: number, height: number): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 ||
      width > MAX_DIMENSION || height > MAX_DIMENSION) {
    throw new Error('invalid library image dimensions');
  }
  return { width, height };
}
function crc32(bytes: Buffer): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
export function validatePng(bytes: Buffer): { width: number; height: number } {
  if (bytes.length < 57 || !bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    throw new Error('invalid PNG signature');
  }
  let pos = 8;
  let dim: { width: number; height: number } | undefined;
  let expectedBytes = 0, rowBytes = 0, paletteRequired = false, paletteSeen = false;
  const data: Buffer[] = [];
  while (pos + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(pos);
    if (length > bytes.length - pos - 12) throw new Error('corrupt PNG chunk');
    const type = bytes.toString('ascii', pos + 4, pos + 8);
    if (crc32(bytes.subarray(pos + 4, pos + 8 + length)) !== bytes.readUInt32BE(pos + 8 + length)) {
      throw new Error('corrupt PNG checksum');
    }
    if (pos === 8) {
      if (type !== 'IHDR' || length !== 13) throw new Error('invalid PNG header');
      dim = dimension(bytes.readUInt32BE(pos + 8), bytes.readUInt32BE(pos + 12));
      const depth = bytes[pos + 16], color = bytes[pos + 17];
      const allowedDepths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (!allowedDepths[color]?.includes(depth) || bytes[pos + 18] !== 0 || bytes[pos + 19] !== 0 || bytes[pos + 20] !== 0) {
        throw new Error('unsupported or invalid PNG header (non-interlaced PNG required)');
      }
      paletteRequired = color === 3;
      const channels: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
      rowBytes = Math.ceil(dim.width * channels[color] * depth / 8) + 1;
      expectedBytes = rowBytes * dim.height;
    }
    if (type === 'IHDR' && pos !== 8) throw new Error('duplicate PNG header');
    if (type === 'PLTE') {
      if (!length || length % 3 || length > 768 || data.length) throw new Error('invalid PNG palette');
      paletteSeen = true;
    }
    if (/^[A-Z]/.test(type) && !['IHDR', 'PLTE', 'IDAT', 'IEND'].includes(type)) throw new Error('unsupported critical PNG chunk');
    if (type === 'IDAT') data.push(bytes.subarray(pos + 8, pos + 8 + length));
    pos += length + 12;
    if (type === 'IEND') {
      if (length !== 0 || pos !== bytes.length || !dim || !data.length) throw new Error('corrupt PNG end');
      try {
        if (paletteRequired && !paletteSeen) throw new Error('missing PNG palette');
        const inflated = inflateSync(Buffer.concat(data), { maxOutputLength: expectedBytes + 1 });
        if (inflated.length !== expectedBytes) throw new Error('invalid PNG scanline size');
        for (let row = 0; row < dim.height; row++) {
          if (inflated[row * rowBytes] > 4) throw new Error('invalid PNG row filter');
        }
      } catch { throw new Error('corrupt PNG image data'); }
      return dim;
    }
  }
  throw new Error('missing PNG image data or end');
}

/** Parse the restricted XML syntax instead of accepting SVG-shaped malformed text. */
function svgAttributes(text: string): Map<string, string> {
  const allowed = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'defs', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'title', 'desc']);
  const stack: string[] = [];
  let root: Map<string, string> | undefined;
  let cursor = 0, elements = 0;
  while (cursor < text.length) {
    if (text[cursor] !== '<') {
      const end = text.indexOf('<', cursor);
      const segment = text.slice(cursor, end === -1 ? text.length : end);
      if (!stack.length && !/^[ \t\r\n]*$/.test(segment)) throw new Error('text outside SVG root');
      cursor = end === -1 ? text.length : end;
      continue;
    }
    let end = cursor + 1, quote = '';
    for (; end < text.length; end++) {
      const char = text[end];
      if (quote) { if (char === quote) quote = ''; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === '>') break;
    }
    if (end === text.length || quote) throw new Error('unterminated SVG tag or attribute');
    const token = text.slice(cursor, end + 1);
    const match = token.match(/^<(\/?)([A-Za-z_][\w:.-]*)([\s\S]*?)>$/);
    if (!match || !allowed.has(match[2])) throw new Error('invalid or unsupported SVG element');
    const [, closing, tag] = match;
    let remainder = match[3];
    if (closing) {
      if (!/^[ \t\r\n]*$/.test(remainder) || stack.pop() !== tag) throw new Error('unbalanced SVG elements');
    } else {
      if (++elements > 10000 || stack.length > 128) throw new Error('SVG element budget exceeded');
      if (!stack.length && root) throw new Error('multiple SVG root elements');
      if (!root && tag !== 'svg') throw new Error('SVG root required');
      const selfClosing = remainder.endsWith('/');
      if (selfClosing) remainder = remainder.slice(0, -1);
      const attributes = new Map<string, string>();
      while (!/^[ \t\r\n]*$/.test(remainder)) {
        const attribute = remainder.match(/^[ \t\r\n]+([A-Za-z_][\w.-]*)[ \t\r\n]*=[ \t\r\n]*(["'])([^<]*?)\2/);
        if (!attribute || attributes.has(attribute[1])) throw new Error('invalid or duplicate SVG attribute');
        attributes.set(attribute[1], attribute[3]);
        remainder = remainder.slice(attribute[0].length);
      }
      if (!root) root = attributes;
      if (!selfClosing) stack.push(tag);
    }
    cursor = end + 1;
  }
  if (!root || stack.length) throw new Error('unbalanced SVG elements');
  return root;
}

/** Conservative SVG subset: no scripts, external resources, CSS, entities or animation. */
export function validateSvg(bytes: Buffer): { width: number; height: number } {
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text) ||
      /<!|<\?|\]\]>|\bon[a-z]+\s*=|\b(?:href|src|style|base)\s*=|@import|javascript:|data:/i.test(text) ||
      /url\(\s*[^#]/i.test(text) || /[&\\]/.test(text)) {
    throw new Error('unsafe or invalid library SVG');
  }
  const root = svgAttributes(text);
  if (root.has('xmlns') && root.get('xmlns') !== 'http://www.w3.org/2000/svg') throw new Error('invalid SVG namespace');
  const viewBox = root.get('viewBox')?.trim().split(/[\s,]+/).map(Number);
  if (viewBox) {
    if (viewBox.length !== 4 || !viewBox.every(Number.isFinite)) throw new Error('invalid SVG viewBox');
    return dimension(viewBox[2], viewBox[3]);
  }
  const width = Number(root.get('width')?.match(/^([\d.]+)(?:px)?$/)?.[1]);
  const height = Number(root.get('height')?.match(/^([\d.]+)(?:px)?$/)?.[1]);
  return dimension(width, height);
}
export function validateMp3(bytes: Buffer): void {
  let position = 0;
  if (bytes.subarray(0, 3).toString('ascii') === 'ID3') {
    if (bytes.length < 10 || [6, 7, 8, 9].some((i) => bytes[i] & 0x80)) throw new Error('invalid MP3 ID3 header');
    position = 10 + ((bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9]);
    if (bytes[5] & 0x10) position += 10;
  }
  let frames = 0;
  while (position < bytes.length) {
    if (bytes.length - position === 128 && bytes.toString('ascii', position, position + 3) === 'TAG') break;
    const a = bytes[position], b = bytes[position + 1], c = bytes[position + 2];
    const version = (b >>> 3) & 3, bitrateIndex = c >>> 4, sampleIndex = (c >>> 2) & 3;
    if (position + 4 > bytes.length || a !== 0xff || (b & 0xe0) !== 0xe0 || version === 1 ||
        ((b >>> 1) & 3) !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || sampleIndex === 3) {
      throw new Error('invalid MP3 frame signature');
    }
    const bitrates = version === 3
      ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
      : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
    const sampleRate = [44100, 48000, 32000][sampleIndex] / (version === 3 ? 1 : version === 2 ? 2 : 4);
    const length = Math.floor((version === 3 ? 144000 : 72000) * bitrates[bitrateIndex] / sampleRate) + ((c >>> 1) & 1);
    if (position + length > bytes.length) throw new Error('truncated MP3 frame');
    position += length;
    frames++;
  }
  if (!frames) throw new Error('missing MP3 frames');
}
export function checkMediaExtension(path: string, format: string): void {
  if (extname(path).toLowerCase() !== `.${format}`) throw new Error('library media extension does not match declared format');
}
