import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dest = join(root, 'dist', 'catalog');
mkdirSync(dest, { recursive: true });
cpSync(join(root, 'catalog'), dest, { recursive: true });
console.log('Copied catalog/ → dist/catalog/');
