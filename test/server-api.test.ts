import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listCategories, searchBlocks } from '../server/catalog-api.ts';
import { buildGuide, matchRecipes } from '../server/recipes.ts';
import { findOutputConflicts, safeEntFilename } from '../server/tools.ts';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = join(ROOT, 'catalog', 'blocks.json');

describe.skipIf(!existsSync(CATALOG))('MCP catalog API', () => {
  it('lists core categories by default (no hardware flood)', () => {
    const core = listCategories('core');
    expect(core.some((c) => c.category === 'flow')).toBe(true);
    expect(core.every((c) => !c.category.startsWith('hardware'))).toBe(true);
    expect(core.length).toBeLessThan(30);
  });

  it('lists hardware categories only with scope=hardware', () => {
    const hw = listCategories('hardware');
    expect(hw.some((c) => c.category.startsWith('hardware'))).toBe(true);
    expect(hw.every((c) => c.category.startsWith('hardware'))).toBe(true);
  });

  it('searches core by default so 반복 hits repeat_basic', () => {
    const hits = searchBlocks('반복');
    expect(hits.some((b) => b.type === 'repeat_basic')).toBe(true);
    expect(hits.every((b) => !b.extension)).toBe(true);
  });

  it('does not return hardware for 반복 under scope=core', () => {
    const hits = searchBlocks('반복', undefined, 50, 'core');
    expect(hits.every((b) => !b.category.startsWith('hardware'))).toBe(true);
  });

  it('searches blocks by English type fragment', () => {
    const hits = searchBlocks('bounce');
    expect(hits.some((b) => b.type === 'bounce_wall')).toBe(true);
  });

  it('ignores surrounding whitespace and case in the query', () => {
    const hits = searchBlocks('  반복  ');
    expect(hits.some((b) => b.type === 'repeat_basic')).toBe(true);
    expect(searchBlocks('BOUNCE').some((b) => b.type === 'bounce_wall')).toBe(true);
  });

  it('respects the limit for an empty query within core', () => {
    expect(searchBlocks('', undefined, 5)).toHaveLength(5);
    expect(searchBlocks('   ', 'flow', 3).every((b) => b.category === 'flow')).toBe(true);
  });

  it('returns TTS under scope=ai', () => {
    const hits = searchBlocks('읽어', undefined, 20, 'ai');
    expect(hits.some((b) => b.type === 'read_text' || b.category.includes('tts'))).toBe(true);
  });
});

describe('build guide recipes', () => {
  it('matches bounce / 튕기 to bounce-loop', () => {
    const recipes = matchRecipes('고양이 벽에 튕기게 해줘');
    expect(recipes[0]?.id).toBe('bounce-loop');
  });

  it('returns workflow and irSketch from get_build_guide', () => {
    const guide = buildGuide('점수 올려줘');
    expect(guide.workflow[0]).toContain('get_build_guide');
    expect(guide.matchedRecipes.some((r) => r.id === 'score-counter')).toBe(true);
    expect(guide.recommendedBlocks.length).toBeGreaterThan(0);
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

describe('findOutputConflicts', () => {
  it('reports only the paths that already exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'entry-vibe-conflict-'));
    const existing = join(dir, 'package.json');
    const missing = join(dir, 'entry-project.ent');
    writeFileSync(existing, '{}');

    expect(findOutputConflicts([existing, missing])).toEqual([existing]);
    expect(findOutputConflicts([missing])).toEqual([]);
  });
});
