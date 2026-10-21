import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import * as tar from 'tar';
import { unpackEnt } from '../compiler/unpack.ts';

interface Entry {
  name: string;
  content?: Buffer;
  type?: string;
  linkname?: string;
}

function header(entry: Entry): Buffer {
  const content = entry.content ?? Buffer.alloc(0);
  const buf = Buffer.alloc(512, 0);
  buf.write(entry.name, 0, 100, 'utf8');
  buf.write('0000644\0', 100, 8, 'ascii');
  buf.write('0000000\0', 108, 8, 'ascii');
  buf.write('0000000\0', 116, 8, 'ascii');
  buf.write(`${content.length.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii');
  buf.write('00000000000\0', 136, 12, 'ascii');
  buf.write('        ', 148, 8, 'ascii');
  buf.write(entry.type ?? '0', 156, 1, 'ascii');
  buf.write(entry.linkname ?? '', 157, 100, 'utf8');
  buf.write('ustar\0', 257, 6, 'ascii');
  buf.write('00', 263, 2, 'ascii');
  let checksum = 0;
  for (const byte of buf) checksum += byte;
  buf.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  return buf;
}

function archive(entries: Entry[]): Buffer {
  const parts: Buffer[] = [];
  for (const entry of entries) {
    const content = entry.content ?? Buffer.alloc(0);
    parts.push(header(entry), content);
    const padding = (512 - (content.length % 512)) % 512;
    if (padding > 0) parts.push(Buffer.alloc(padding));
  }
  parts.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(parts));
}

describe('unpackEnt archive safety', () => {
  let work: string;

  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), 'entry-vibe-security-'));
  });

  afterEach(() => {
    rmSync(work, { recursive: true, force: true });
  });

  function writeEnt(name: string, entries: Entry[]): string {
    const path = join(work, name);
    writeFileSync(path, archive(entries));
    return path;
  }

  it('rejects path traversal entries', async () => {
    const ent = writeEnt('traversal.ent', [{ name: '../escape.txt', content: Buffer.from('x') }]);
    await expect(unpackEnt(ent, { cwd: work })).rejects.toThrow(/path traversal/);
  });

  it('rejects absolute entry paths', async () => {
    const ent = writeEnt('absolute.ent', [{ name: '/tmp/entry-vibe-absolute.txt', content: Buffer.from('x') }]);
    await expect(unpackEnt(ent, { cwd: work })).rejects.toThrow(/absolute path/);
  });

  it('rejects symbolic links', async () => {
    const ent = writeEnt('symlink.ent', [{ name: 'temp/link', type: '2', linkname: '/etc/passwd' }]);
    await expect(unpackEnt(ent, { cwd: work })).rejects.toThrow(/link/);
  });

  it('rejects hard links', async () => {
    const ent = writeEnt('hardlink.ent', [{ name: 'temp/link', type: '1', linkname: 'temp/project.json' }]);
    await expect(unpackEnt(ent, { cwd: work })).rejects.toThrow(/link/);
  });

  it('rejects entries larger than the per-entry limit', async () => {
    const ent = writeEnt('oversized.ent', [{ name: 'temp/big.bin', content: Buffer.alloc(5) }]);
    await expect(unpackEnt(ent, { cwd: work, maxEntryBytes: 4 })).rejects.toThrow(/exceeds 4 bytes/);
  });

  it('rejects archives larger than the cumulative limit', async () => {
    const ent = writeEnt('cumulative.ent', [
      { name: 'temp/a.bin', content: Buffer.alloc(8) },
      { name: 'temp/b.bin', content: Buffer.alloc(8) },
    ]);
    await expect(
      unpackEnt(ent, { cwd: work, maxEntryBytes: 100, maxTotalBytes: 10 }),
    ).rejects.toThrow(/exceeds 10 extracted bytes/);
  });

  it('rejects invalid byte limits before extraction', async () => {
    const ent = writeEnt('valid.ent', [{ name: 'temp/project.json', content: Buffer.from('{}') }]);
    await expect(unpackEnt(ent, { cwd: work, maxEntryBytes: 0 })).rejects.toThrow(/positive integers/);
  });

  it('rejects entries that are neither regular files nor directories', async () => {
    const ent = writeEnt('fifo.ent', [{ name: 'temp/pipe', type: '6' }]);
    await expect(unpackEnt(ent, { cwd: work })).rejects.toThrow(/unsupported type/);
  });

  it('rejects a temp/project.json that is not a regular file', async () => {
    const ent = writeEnt('project-dir.ent', [{ name: 'temp/project.json/', type: '5' }]);
    await expect(unpackEnt(ent, { cwd: work })).rejects.toThrow(/must be a regular file/);
  });

  it('accepts regular files written with NUL or contiguous typeflags', async () => {
    for (const type of ['\0', '7']) {
      const ent = writeEnt(`type-${type.charCodeAt(0)}.ent`, [
        { name: 'temp/project.json', content: Buffer.from('{}'), type },
      ]);
      const result = await unpackEnt(ent, { cwd: work });
      expect(result.project).toEqual({});
    }
  });

  it('extracts archives whose entry paths exceed 100 characters', async () => {
    const staging = mkdtempSync(join(tmpdir(), 'entry-vibe-longpath-'));
    try {
      const longPath = `temp/${'x'.repeat(140)}.bin`;
      mkdirSync(join(staging, 'temp'), { recursive: true });
      writeFileSync(join(staging, 'temp', 'project.json'), '{}');
      writeFileSync(join(staging, longPath), 'data');
      const ent = join(staging, 'long.ent');
      await tar.c({ gzip: true, file: ent, cwd: staging, portable: true }, ['temp']);

      const result = await unpackEnt(ent, { cwd: work });
      expect(result.project).toEqual({});
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  });

  it('still extracts a valid archive within the limits', async () => {
    const ent = writeEnt('ok.ent', [{ name: 'temp/project.json', content: Buffer.from('{}') }]);
    const result = await unpackEnt(ent, { cwd: work, maxEntryBytes: 1024, maxTotalBytes: 1024 });
    expect(result.project).toEqual({});
    expect(existsSync(join(work, 'assets'))).toBe(true);
  });
});
