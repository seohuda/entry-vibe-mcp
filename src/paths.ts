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
  // No explicit root: write next to wherever the MCP host launched the
  // server from, not inside entry-vibe-mcp's own install directory — the
  // host's cwd is normally the user's project, which is what compile_project
  // output should land in.
  if (root === undefined) return join(process.cwd(), 'output');
  // Explicit root (e.g. the example script): keep it package-relative.
  if (existsSync(join(root, 'package.json'))) return join(root, 'output');
  return join(root, '..', 'output');
}
