// Copy repo files that ship as static web assets into web/public. Runs on
// predev + prebuild so the served copies never drift from their sources.
// Keep this the ONLY writer of these public copies.
//   - .claude/skills/flow-agent-member/SKILL.md → the logged-out agent-skill download
//   - FEATURES.md (repo root)           → the "What's new" lightbox (Build label)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');

const copies = [
  [path.join(repoRoot, '.claude/skills/flow-agent-member/SKILL.md'), path.resolve(here, '../public/flow-agent-member-SKILL.md')],
  [path.join(repoRoot, 'FEATURES.md'), path.resolve(here, '../public/FEATURES.md')],
];

for (const [src, dest] of copies) {
  if (!fs.existsSync(src)) {
    // Fail loudly rather than shipping a stale public copy. Usually means the
    // source moved and this list wasn't updated with it.
    throw new Error(
      `copy-skill: missing source ${path.relative(repoRoot, src)} — if it moved, update the copies list in ${path.relative(repoRoot, fileURLToPath(import.meta.url))}`,
    );
  }
  fs.copyFileSync(src, dest);
  console.log(`copied → ${path.relative(process.cwd(), dest)}`);
}
