import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Walk up from a module URL until catalog/blocks.json is found. */
export function findPackageRoot(fromImportMetaUrl: string = import.meta.url): string {
  let dir = dirname(fileURLToPath(fromImportMetaUrl));
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'catalog', 'blocks.json'))) {
      return dir;
    }
    // Built layout: dist/catalog + repo-root vendor
    if (
      existsSync(join(dir, 'package.json')) &&
      existsSync(join(dir, 'dist', 'catalog', 'blocks.json'))
    ) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback: two levels up from this file (src/ or dist/src/)
  return join(dirname(fileURLToPath(fromImportMetaUrl)), '..');
}

export function catalogPath(root?: string): string {
  const r = root ?? findPackageRoot();
  const direct = join(r, 'catalog', 'blocks.json');
  if (existsSync(direct)) return direct;
  return join(r, 'dist', 'catalog', 'blocks.json');
}

export function mediaDir(root?: string): string {
  const r = root ?? findPackageRoot();
  // assets/ ships with the package; vendor/ is only present after fetch:entryjs
  const candidates = [
    join(r, 'assets', 'media'),
    join(r, '..', 'assets', 'media'),
    join(r, 'vendor', 'entryjs', 'images', 'media'),
    join(r, '..', 'vendor', 'entryjs', 'images', 'media'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0];
}

export function outputDir(root?: string): string {
  const r = root ?? findPackageRoot();
  // Prefer repo root output/, not dist/output
  if (existsSync(join(r, 'package.json'))) return join(r, 'output');
  return join(r, '..', 'output');
}
