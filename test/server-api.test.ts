import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getBlockSchemas,
  listCategories,
  searchBlocks,
} from '../server/catalog-api.ts';
import { safeEntFilename } from '../server/tools.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = join(ROOT, 'catalog', 'blocks.json');

describe.skipIf(!existsSync(CATALOG))('MCP catalog API', () => {
  it('lists categories', () => {
    const cats = listCategories();
    expect(cats.some((c) => c.category === 'flow')).toBe(true);
    expect(cats.some((c) => c.category === 'moving')).toBe(true);
  });

  it('searches blocks by Korean label', () => {
    const hits = searchBlocks('반복');
    expect(hits.some((b) => b.type === 'repeat_basic')).toBe(true);
  });

  it('searches blocks by English type fragment', () => {
    const hits = searchBlocks('bounce');
    expect(hits.some((b) => b.type === 'bounce_wall')).toBe(true);
  });

  it('returns detailed schemas', () => {
    const schemas = getBlockSchemas(['repeat_basic', 'when_run_button_click']);
    expect(schemas).toHaveLength(2);
    const repeat = schemas.find((s) => s.type === 'repeat_basic')!;
    expect(repeat.statementKeys).toContain('DO');
  });
});

describe('safeEntFilename', () => {
  it('defaults and normalizes the extension', () => {
    expect(safeEntFilename()).toBe('entry-project.ent');
    expect(safeEntFilename('cat')).toBe('cat.ent');
    expect(safeEntFilename('cat.ent')).toBe('cat.ent');
    expect(safeEntFilename('  cat.ENT  ')).toBe('cat.ent');
    expect(safeEntFilename('고양이')).toBe('고양이.ent');
  });

  it('rejects anything that could escape the output directory', () => {
    for (const bad of [
      '../../../tmp/pwn',
      'sub/dir/cat.ent',
      '..\\windows\\cat',
      '/etc/passwd',
      '..',
      '.ent',
      '   ',
      'cat\0.ent',
    ]) {
      expect(() => safeEntFilename(bad), bad).toThrow();
    }
  });
});
