// Bake the default Flow server into the build, the way apps/macos/tools/make-app.sh
// bakes FLOW_SERVER_URL into the bundle. Unset = production. A development run
// may still override it at run time (see src/main/config.ts); a packaged app
// never does.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const raw = (process.env.FLOW_SERVER_URL ?? 'https://app.freeflow.im').trim().replace(/\/+$/, '');
const url = new URL(raw);
if (!['http:', 'https:'].includes(url.protocol) || url.origin !== raw) {
  throw new Error(`FLOW_SERVER_URL must be a bare http(s) origin, got "${raw}"`);
}
mkdirSync(resolve(root, 'dist'), { recursive: true });
writeFileSync(resolve(root, 'dist/config.json'), JSON.stringify({ defaultServerOrigin: raw }, null, 2) + '\n');
console.log(`desktop: default server ${raw}`);
