// Keep SQL migrations beside the compiled server. Use Node instead of shell
// `mkdir`/`cp` so the canonical workspace build behaves the same on Windows,
// macOS, and Linux.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sourceDir = path.resolve(here, '../src/db/migrations');
const outputDir = path.resolve(here, '../dist/db/migrations');
const migrations = fs.readdirSync(sourceDir).filter((name) => name.endsWith('.sql')).sort();

// A renamed migration must not leave its old name in a reused build directory.
fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });
for (const name of migrations) {
  fs.copyFileSync(path.join(sourceDir, name), path.join(outputDir, name));
}

console.log(`copied ${migrations.length} migration(s) to dist/db/migrations`);
