#!/usr/bin/env tsx
/**
 * Shallow-clone entrylabs/entryjs into vendor/entryjs for catalog extraction.
 */
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = join(ROOT, 'vendor');
const TARGET = join(VENDOR, 'entryjs');
const REPO = 'https://github.com/entrylabs/entryjs.git';

async function main() {
  if (existsSync(join(TARGET, 'src', 'playground', 'blocks'))) {
    console.log(`entryjs already present at ${TARGET}`);
    return;
  }

  await mkdir(VENDOR, { recursive: true });

  if (existsSync(TARGET)) {
    console.error(
      `Partial vendor/entryjs found. Remove it and re-run:\n  rm -rf ${TARGET}`,
    );
    process.exit(1);
  }

  console.log(`Cloning ${REPO} (depth 1) → ${TARGET}`);
  const result = spawnSync(
    'git',
    ['clone', '--depth', '1', REPO, TARGET],
    { stdio: 'inherit' },
  );

  if (result.status !== 0) {
    console.error('Failed to clone entryjs');
    process.exit(result.status ?? 1);
  }

  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
