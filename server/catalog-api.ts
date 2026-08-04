import { readFileSync } from 'node:fs';
import type { BlockCatalog, BlockSchema } from '../src/types/block.ts';
import { loadCatalog } from '../compiler/validate.ts';
import { catalogPath, findPackageRoot } from '../src/paths.ts';

export function getCatalog(): BlockCatalog {
  return loadCatalog(catalogPath());
}

export function summarizeBlock(block: BlockSchema) {
  return {
    type: block.type,
    category: block.category,
    label: block.label.ko,
    isHat: block.isHat,
    statementSlots: block.statementSlots,
    statementKeys: block.statementKeys,
    params: block.params
      .filter((p) => p.type !== 'Indicator' && p.type !== 'LineBreak')
      .map((p) => ({
        key: p.key,
        type: p.type,
        accept: p.accept,
        defaultType: p.defaultType,
        options: p.options?.map((o) => o.value),
      })),
  };
}

export function searchBlocks(
  query: string,
  category?: string,
  limit = 20,
): ReturnType<typeof summarizeBlock>[] {
  const q = query.trim().toLowerCase();
  const inCategory = (b: BlockSchema) => (category ? b.category === category : true);

  const catalog = getCatalog();
  // An empty query has nothing to rank by; return the category listing as-is
  // rather than letting `includes('')` score every block identically.
  if (!q) {
    return catalog.blocks.filter(inCategory).slice(0, limit).map(summarizeBlock);
  }

  const scored = catalog.blocks
    .filter(inCategory)
    .map((b) => {
      const label = b.label.ko.toLowerCase();
      const hay = `${b.type} ${label} ${b.category}`.toLowerCase();
      let score = 0;
      if (b.type === q) score += 100;
      if (b.type.includes(q)) score += 50;
      if (label.includes(q)) score += 40;
      for (const token of q.split(/\s+/).filter(Boolean)) {
        if (hay.includes(token)) score += 10;
      }
      return { block: b, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map((s) => summarizeBlock(s.block));
}

export function getBlockSchemas(types: string[]): BlockSchema[] {
  const index = new Map(getCatalog().blocks.map((b) => [b.type, b]));
  return types.map((t) => index.get(t)).filter((b): b is BlockSchema => Boolean(b));
}

export function listCategories(): Array<{ category: string; count: number }> {
  const counts = new Map<string, number>();
  for (const b of getCatalog().blocks) {
    counts.set(b.category, (counts.get(b.category) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => a.category.localeCompare(b.category));
}

export function assertCatalogPresent(): void {
  readFileSync(catalogPath(), 'utf8');
}

export { findPackageRoot };
