// Regenerates src/slack-emoji.json: every standard Slack emoji name -> unicode.
// Slack's names are iamcal's emoji-data set, published as `emoji-datasource`
// (MIT). The package is 28 MB of images, so only this 38 KB map is checked in.
//
//   node scripts/build-slack-emoji.mjs [version]
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const version = process.argv[2] ?? '16.0.0';
const dir = mkdtempSync(join(tmpdir(), 'slack-emoji-'));
execFileSync('npm', ['pack', `emoji-datasource@${version}`], { cwd: dir, stdio: 'ignore' });
execFileSync('tar', ['-xzf', `emoji-datasource-${version}.tgz`, 'package/emoji.json'], { cwd: dir });
const rows = JSON.parse(readFileSync(join(dir, 'package/emoji.json'), 'utf8'));
const map = {};
for (const row of rows.sort((a, b) => a.sort_order - b.sort_order)) {
  const unicode = String.fromCodePoint(...row.unified.split('-').map(hex => parseInt(hex, 16)));
  for (const name of row.short_names) map[name] = unicode;
}
writeFileSync(new URL('../src/slack-emoji.json', import.meta.url), `${JSON.stringify(map)}\n`);
console.log(`wrote ${Object.keys(map).length} names from emoji-datasource@${version}`);
