// Copy the canonical agent skill into web/public so it ships as a static
// download from the logged-out home page. Runs on predev + prebuild so the
// served copy never drifts from skills/flow-agent-member/SKILL.md (the source
// of truth). Keep this the ONLY writer of the public copy.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, '../../../skills/flow-agent-member/SKILL.md');
const dest = path.resolve(here, '../public/flow-agent-member-SKILL.md');

fs.copyFileSync(src, dest);
console.log(`copied skill → ${path.relative(process.cwd(), dest)}`);
