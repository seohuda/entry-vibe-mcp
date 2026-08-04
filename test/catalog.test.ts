import { describe, expect, it, beforeAll } from 'vitest';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractCatalog } from '../scripts/extract-catalog.ts';
import type { BlockSchema } from '../src/types/block.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRYJS = join(ROOT, 'vendor', 'entryjs');

function byType(blocks: BlockSchema[], type: string): BlockSchema {
  const b = blocks.find((x) => x.type === type);
  if (!b) throw new Error(`Block not found: ${type}`);
  return b;
}

describe.skipIf(!existsSync(ENTRYJS))('catalog extraction (start/moving/flow)', () => {
  let blocks: BlockSchema[];

  beforeAll(() => {
    const catalog = extractCatalog(['start', 'moving', 'flow']);
    blocks = catalog.blocks;
  });


  it('extracts when_run_button_click as a hat block', () => {
    const b = byType(blocks, 'when_run_button_click');
    expect(b.category).toBe('start');
    expect(b.isHat).toBe(true);
    expect(b.skeleton).toBe('basic_event');
    expect(b.statementSlots).toBe(0);
    expect(b.label.ko).toContain('시작하기');
  });

  it('extracts move_direction with VALUE param', () => {
    const b = byType(blocks, 'move_direction');
    expect(b.category).toBe('moving');
    expect(b.isHat).toBe(false);
    expect(b.statementSlots).toBe(0);

    const value = b.params.find((p) => p.key === 'VALUE');
    expect(value).toBeDefined();
    expect(value!.type).toBe('Block');
    expect(value!.accept).toBe('string');
    expect(value!.defaultType).toBe('number');
    expect(value!.defaultValue).toEqual({ type: 'number', params: ['10'] });

    const indicator = b.params.find((p) => p.type === 'Indicator');
    expect(indicator).toBeDefined();
  });

  it('extracts repeat_basic with VALUE and DO statement slot', () => {
    const b = byType(blocks, 'repeat_basic');
    expect(b.category).toBe('flow');
    expect(b.isHat).toBe(false);
    expect(b.statementSlots).toBe(1);
    expect(b.statementKeys).toEqual(['DO']);
    expect(b.skeleton).toBe('basic_loop');

    const value = b.params.find((p) => p.key === 'VALUE');
    expect(value).toBeDefined();
    expect(value!.type).toBe('Block');
    expect(value!.defaultValue).toEqual({ type: 'number', params: ['10'] });
  });

  it('extracts if_else with two statement slots', () => {
    const b = byType(blocks, 'if_else');
    expect(b.statementSlots).toBe(2);
    expect(b.statementKeys).toEqual(['STACK_IF', 'STACK_ELSE']);
  });
});

describe.skipIf(!existsSync(ENTRYJS))('catalog extraction (all v1 categories)', () => {
  it('extracts blocks from all 12 core categories', () => {
    const catalog = extractCatalog();
    expect(catalog.blocks.length).toBeGreaterThan(100);
    const cats = new Set(catalog.blocks.map((b) => b.category));
    for (const c of [
      'start',
      'moving',
      'looks',
      'flow',
      'judgement',
      'calc',
      'variable',
      'func',
      'sound',
      'text',
      'brush',
      'analysis',
    ]) {
      expect(cats.has(c)).toBe(true);
    }
  });
});
