#!/usr/bin/env tsx
/**
 * Extract Entry block schemas from entryjs sources into catalog/blocks.json.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BlockCatalog, BlockSchema } from '../src/types/block.ts';
import { extractBlocksFromFile, loadLangMaps } from './lib/extract-blocks.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRYJS = join(ROOT, 'vendor', 'entryjs');
const BLOCKS_DIR = join(ENTRYJS, 'src', 'playground', 'blocks');
const LANG_KO = join(ENTRYJS, 'extern', 'lang', 'ko.js');
const OUT_DIR = join(ROOT, 'catalog');

/** v1 core categories (AI / hardware excluded). */
export const V1_CATEGORIES = [
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
] as const;

export type V1Category = (typeof V1_CATEGORIES)[number];

export function extractCatalog(categories: readonly string[] = V1_CATEGORIES): BlockCatalog {
  if (!existsSync(BLOCKS_DIR)) {
    throw new Error(
      `entryjs not found at ${ENTRYJS}. Run: npm run fetch:entryjs`,
    );
  }
  if (!existsSync(LANG_KO)) {
    throw new Error(`Language file missing: ${LANG_KO}`);
  }

  const lang = loadLangMaps(LANG_KO);
  const wanted = new Set(categories);
  const all: BlockSchema[] = [];

  for (const cat of categories) {
    const filePath = join(BLOCKS_DIR, `block_${cat}.js`);
    if (!existsSync(filePath)) {
      console.warn(`Missing block file: ${filePath}`);
      continue;
    }
    const blocks = extractBlocksFromFile(filePath, cat, lang);
    all.push(...blocks);
    console.log(`  ${cat}: ${blocks.length} blocks`);
  }

  // Sanity: ensure we only got wanted categories
  const filtered = all.filter((b) => wanted.has(b.category));

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    blocks: filtered,
  };
}

export function writeCatalog(catalog: BlockCatalog): void {
  mkdirSync(join(OUT_DIR, 'blocks'), { recursive: true });

  const byCategory = new Map<string, BlockSchema[]>();
  for (const block of catalog.blocks) {
    const list = byCategory.get(block.category) ?? [];
    list.push(block);
    byCategory.set(block.category, list);
  }

  for (const [category, blocks] of byCategory) {
    writeFileSync(
      join(OUT_DIR, 'blocks', `${category}.json`),
      JSON.stringify({ category, blocks }, null, 2) + '\n',
    );
  }

  writeFileSync(
    join(OUT_DIR, 'blocks.json'),
    JSON.stringify(catalog, null, 2) + '\n',
  );
}

function main() {
  const only = process.argv.slice(2);
  const categories = only.length > 0 ? only : [...V1_CATEGORIES];

  console.log(`Extracting categories: ${categories.join(', ')}`);
  const catalog = extractCatalog(categories);
  writeCatalog(catalog);
  console.log(`Wrote ${catalog.blocks.length} blocks → catalog/blocks.json`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  try {
    main();
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
