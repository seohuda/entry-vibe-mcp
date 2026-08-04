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
  if (process.env.ENTRY_VIBE_OUTPUT_DIR) return process.env.ENTRY_VIBE_OUTPUT_DIR;
  // No explicit root: write directly into wherever the MCP host launched the
  // server from — not a nested output/ subfolder, and not entry-vibe-mcp's
  // own install directory, which is normally unrelated to the user's project.
  if (root === undefined) return process.cwd();
  // Explicit root (e.g. the example script): keep it package-relative,
  // organized under output/ since that's shared repo scratch space.
  if (existsSync(join(root, 'package.json'))) return join(root, 'output');
  return join(root, '..', 'output');
}
