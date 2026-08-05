import { describe, expect, it, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractCatalog } from '../scripts/extract-catalog.ts';
import { searchBlocks } from '../server/catalog-api.ts';
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

describe.skipIf(!existsSync(ENTRYJS))('catalog extraction (all core categories)', () => {
  it('extracts blocks from all 12 core categories', () => {
    const catalog = extractCatalog([
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
    ]);
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

describe.skipIf(!existsSync(ENTRYJS))('catalog extraction (AI / hardware)', () => {
  it('extracts AI utilize TTS blocks with extension metadata', () => {
    const catalog = extractCatalog(['ai_utilize_tts']);
    expect(catalog.blocks.length).toBeGreaterThan(0);
    const sample = catalog.blocks[0];
    expect(sample.extension).toEqual({ kind: 'aiUtilize', module: 'tts' });
    expect(sample.category).toBe('ai_utilize_tts');
  });

  it('extracts Arduino hardware blocks with extension metadata', () => {
    const catalog = extractCatalog(['hardware_arduino']);
    expect(catalog.blocks.length).toBeGreaterThan(0);
    expect(catalog.blocks[0].extension?.kind).toBe('hardware');
    expect(catalog.blocks[0].extension?.module).toBe('arduino');
  });
});

describe('shipped catalog labels', () => {
  const blocks = (
    JSON.parse(readFileSync(join(ROOT, 'catalog', 'blocks.json'), 'utf8')) as {
      blocks: BlockSchema[];
    }
  ).blocks;

  it('resolves a Korean label for the vast majority of core blocks', () => {
    // label.ko === type means no label was found; these are mostly Entry's
    // block-menu buttons and lecture-only internals.
    const core = blocks.filter((b) => !b.extension);
    const unlabeled = core.filter((b) => b.label.ko === b.type);
    expect(unlabeled.length).toBeLessThanOrEqual(22);
  });

  it('includes AI utilize and hardware categories when shipped catalog is full', () => {
    const cats = new Set(blocks.map((b) => b.category));
    // Full extract ships these; older v1 catalogs may not — skip soft-check via length.
    if (blocks.length > 500) {
      expect(cats.has('ai_utilize_tts')).toBe(true);
      expect([...cats].some((c) => c.startsWith('hardware_'))).toBe(true);
    }
  });

  it('labels blocks whose template is only placeholders', () => {
    // These read "%1 %2 %3" in Lang.template; the words live in Lang.Blocks.
    expect(byType(blocks, 'calc_rand').label.ko).toContain('무작위');
    expect(byType(blocks, 'is_clicked').label.ko).toContain('클릭');
    expect(byType(blocks, 'length_of_string').label.ko).toContain('글자');
    // Filed under `sound`, but keyed CALC_get_sound_volume in Lang.Blocks
    expect(byType(blocks, 'get_sound_volume').label.ko).toContain('소리');
  });

  it('excludes block-menu buttons and function param slots', () => {
    // basic_button / basic_param are not placeable, and the buttons used to be
    // reported as hat blocks, so validate accepted them as a thread's opener.
    for (const type of [
      'variableAddButton',
      'listAddButton',
      'functionAddButton',
      'messageAddButton',
      'showFunctionPropsButton',
      'analizyDataAddButton',
      'function_field_string',
    ]) {
      expect(blocks.some((b) => b.type === type), type).toBe(false);
    }
    expect(blocks.every((b) => b.skeleton !== 'basic_button')).toBe(true);
  });

  it('only marks real event blocks as hats', () => {
    for (const b of blocks.filter((x) => x.isHat)) {
      expect(['basic_event', 'basic_create', 'basic_create_value'], b.type).toContain(
        b.skeleton,
      );
    }
  });

  it('finds those blocks by Korean keyword', () => {
    expect(searchBlocks('무작위').map((b) => b.type)).toContain('calc_rand');
    expect(searchBlocks('글자 수').map((b) => b.type)).toContain('length_of_string');
  });
});
