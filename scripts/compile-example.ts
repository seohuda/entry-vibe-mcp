/**
 * Compile one of examples/*.ir.json straight to output/<name>.ent, without
 * going through an MCP host — a quick way to sanity-check an IR by hand.
 *
 * Usage: npm run example -- <name>   (e.g. npm run example -- todo-list)
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileProject, CompileError } from '../compiler/compile.ts';
import { packEnt } from '../compiler/pack.ts';
import { findPackageRoot, outputDir } from '../src/paths.ts';
import type { EntryIR } from '../src/types/ir.ts';

const name = process.argv[2];
if (!name) {
  console.error('Usage: npm run example -- <name>  (e.g. npm run example -- todo-list)');
  process.exit(1);
}

const root = findPackageRoot();
const irPath = join(root, 'examples', `${name.replace(/\.ir\.json$/, '')}.ir.json`);
if (!existsSync(irPath)) {
  console.error(`Not found: ${irPath}`);
  process.exit(1);
}

const ir = JSON.parse(readFileSync(irPath, 'utf8')) as EntryIR;

try {
  const project = compileProject(ir);
  const entPath = join(outputDir(root), `${name}.ent`);
  await packEnt(project, { outputPath: entPath });
  console.log(`✔ ${entPath}`);
} catch (err) {
  if (err instanceof CompileError) {
    console.error('검증 실패:');
    for (const e of err.errors) console.error(`  - ${e}`);
  } else {
    console.error(err);
  }
  process.exit(1);
}
