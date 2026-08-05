#!/usr/bin/env tsx
/**
 * Extract Entry block schemas from entryjs sources into catalog/blocks.json.
 *
 * Covers core categories plus AI utilize/learning, expansion, hardware, and
 * hardwareLite modules under vendor/entryjs/src/playground/blocks.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BlockCatalog, BlockExtension, BlockExtensionKind, BlockSchema } from '../src/types/block.ts';
import { extractBlocksFromFile, loadLangMaps } from './lib/extract-blocks.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRYJS = join(ROOT, 'vendor', 'entryjs');
const BLOCKS_DIR = join(ENTRYJS, 'src', 'playground', 'blocks');
const LANG_KO = join(ENTRYJS, 'extern', 'lang', 'ko.js');
const OUT_DIR = join(ROOT, 'catalog');

/** Core (built-in) categories. */
export const CORE_CATEGORIES = [
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

/** @deprecated Use CORE_CATEGORIES — kept for older tests/imports. */
export const V1_CATEGORIES = CORE_CATEGORIES;

export type CoreCategory = (typeof CORE_CATEGORIES)[number];

export interface CatalogSource {
  filePath: string;
  category: string;
  extension?: BlockExtension;
}

function snakeToCamel(snake: string): string {
  return snake.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** Prefer `name: '…'` near the top of the module; fall back to filename stem. */
function inferModuleName(filePath: string, fallback: string): string {
  const head = readFileSync(filePath, 'utf8').slice(0, 4000);
  const match = head.match(/\bname:\s*['"]([^'"]+)['"]/);
  return match?.[1] ?? fallback;
}

function listBlockFiles(dir: string, prefix: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.js') && f !== 'index.js')
    .sort();
}

/**
 * Discover every block source file we know how to catalog.
 * Pass category names (core only) or leave empty for the full catalog.
 */
export function discoverSources(onlyCategories?: readonly string[]): CatalogSource[] {
  const sources: CatalogSource[] = [];
  const only = onlyCategories?.length ? new Set(onlyCategories) : null;

  const push = (source: CatalogSource) => {
    if (only && !only.has(source.category)) return;
    sources.push(source);
  };

  for (const cat of CORE_CATEGORIES) {
    push({
      filePath: join(BLOCKS_DIR, `block_${cat}.js`),
      category: cat,
    });
  }

  // AI utilize: block_ai_utilize_tts.js → category ai_utilize_tts, module tts
  for (const file of listBlockFiles(BLOCKS_DIR, 'block_ai_utilize_')) {
    const stem = file.replace(/^block_/, '').replace(/\.js$/, ''); // ai_utilize_tts
    const moduleSnake = stem.replace(/^ai_utilize_/, '');
    const module = snakeToCamel(moduleSnake);
    const filePath = join(BLOCKS_DIR, file);
    push({
      filePath,
      category: stem,
      extension: {
        kind: 'aiUtilize',
        module: inferModuleName(filePath, module),
      },
    });
  }

  // AI learning: block_ai_learning.js + block_ai_learning_knn.js …
  for (const file of listBlockFiles(BLOCKS_DIR, 'block_ai_learning')) {
    const stem = file.replace(/^block_/, '').replace(/\.js$/, '');
    const filePath = join(BLOCKS_DIR, file);
    const module =
      stem === 'ai_learning' ? 'ai_learning' : inferModuleName(filePath, snakeToCamel(stem));
    push({
      filePath,
      category: stem,
      extension: { kind: 'aiLearning', module },
    });
  }

  // Expansion: block_expansion_weather.js → expansion_weather / weather
  for (const file of listBlockFiles(BLOCKS_DIR, 'block_expansion_')) {
    const stem = file.replace(/^block_/, '').replace(/\.js$/, '');
    const moduleSnake = stem.replace(/^expansion_/, '');
    const filePath = join(BLOCKS_DIR, file);
    push({
      filePath,
      category: stem,
      extension: {
        kind: 'expansion',
        module: inferModuleName(filePath, snakeToCamel(moduleSnake)),
      },
    });
  }

  const hwDir = join(BLOCKS_DIR, 'hardware');
  for (const file of listBlockFiles(hwDir, 'block_')) {
    const moduleSnake = file.replace(/^block_/, '').replace(/\.js$/, '');
    const filePath = join(hwDir, file);
    const module = inferModuleName(filePath, moduleSnake);
    push({
      filePath,
      category: `hardware_${moduleSnake}`,
      extension: { kind: 'hardware', module },
    });
  }

  const hwLiteDir = join(BLOCKS_DIR, 'hardwareLite');
  for (const file of listBlockFiles(hwLiteDir, 'block_')) {
    const moduleSnake = file.replace(/^block_/, '').replace(/\.js$/, '');
    const filePath = join(hwLiteDir, file);
    const module = inferModuleName(filePath, moduleSnake);
    push({
      filePath,
      category: `hardware_lite_${moduleSnake}`,
      extension: { kind: 'hardwareLite', module },
    });
  }

  return sources;
}

export function extractCatalog(categories?: readonly string[]): BlockCatalog {
  if (!existsSync(BLOCKS_DIR)) {
    throw new Error(
      `entryjs not found at ${ENTRYJS}. Run: npm run fetch:entryjs`,
    );
  }
  if (!existsSync(LANG_KO)) {
    throw new Error(`Language file missing: ${LANG_KO}`);
  }

  const lang = loadLangMaps(LANG_KO);
  const sources = discoverSources(categories);
  const byType = new Map<string, BlockSchema>();
  const kindCounts = new Map<BlockExtensionKind | 'core', number>();

  for (const source of sources) {
    if (!existsSync(source.filePath)) {
      console.warn(`Missing block file: ${source.filePath}`);
      continue;
    }
    const blocks = extractBlocksFromFile(source.filePath, source.category, lang);
    for (const block of blocks) {
      if (source.extension) {
        block.extension = source.extension;
      }
      // First definition wins — shared helper block types stay with the first module.
      if (!byType.has(block.type)) {
        byType.set(block.type, block);
      }
    }
    const kind = source.extension?.kind ?? 'core';
    kindCounts.set(kind, (kindCounts.get(kind) ?? 0) + blocks.length);
    console.log(`  ${source.category}: ${blocks.length} blocks`);
  }

  for (const [kind, count] of [...kindCounts.entries()].sort()) {
    console.log(`  [${kind}] ${count} blocks`);
  }

  return {
    version: 2,
    generatedAt: new Date().toISOString(),
    blocks: [...byType.values()],
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
  const categories = only.length > 0 ? only : undefined;

  console.log(
    categories
      ? `Extracting categories: ${categories.join(', ')}`
      : 'Extracting full catalog (core + AI + expansion + hardware)',
  );
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
