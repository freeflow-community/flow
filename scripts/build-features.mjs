// Generate FEATURES.md (repo root) from the changelog/ entry files.
//
// Every entry file is changelog/YYYY-MM-DD-<slug>.md. If it has a
// "## Feature" section, that section's body is a user-facing note; this
// script collects those notes, groups them by date (newest first), and
// appends changelog/FEATURES_ARCHIVE.md (the hand-written file as it stood
// when generation started, frozen). See changelog/README.md.
//
// FEATURES.md is gitignored — never edit it by hand. This script runs on the
// web predev/prebuild and in apps/macos/tools/make-app.sh, and can be run
// directly: node scripts/build-features.mjs
//
// `buildFeatures()` is also imported by the server, which serves the same
// notes as the "What's New" help page (#474) — the help page and the build
// version menu are then the same text from the same source, and cannot drift.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const HEADER = `# What's new in Flow

A plain-language log of user-visible features and improvements, newest first.
For the full technical changelog see the \`changelog/\` directory and the
\`CHANGES_ARCHIVE_*.log\` files.

`;

// Only date-prefixed files are entries; README.md and FEATURES_ARCHIVE.md
// live in the same directory and are skipped by this pattern.
const ENTRY_RE = /^(\d{4}-\d{2}-\d{2})-[a-z0-9][a-z0-9-]*\.md$/;

// The body of the "## Feature" section: everything after that heading up to
// the next "## " heading or the end of the file.
function featureSection(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^## Feature\s*$/.test(l));
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) { end = i; break; }
  }
  const body = lines.slice(start + 1, end).join('\n').trim();
  return body || null;
}

/**
 * Build the FEATURES.md text from a checkout. Returns the markdown and a
 * one-line summary of what went into it (for the CLI's log line).
 */
export function buildFeatures(root = repoRoot) {
  const changelogDir = path.join(root, 'changelog');
  const entries = fs
    .readdirSync(changelogDir)
    .filter((f) => ENTRY_RE.test(f))
    .sort()
    .reverse(); // newest date first; same-date order is by slug, reversed — arbitrary but stable

  const byDate = new Map();
  for (const file of entries) {
    const body = featureSection(fs.readFileSync(path.join(changelogDir, file), 'utf8'));
    if (!body) continue; // internal-only change
    const date = file.slice(0, 10);
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(body);
  }

  let markdown = HEADER;
  for (const [date, bodies] of byDate) {
    markdown += `## ${date}\n\n${bodies.join('\n\n')}\n\n`;
  }
  markdown += fs.readFileSync(path.join(changelogDir, 'FEATURES_ARCHIVE.md'), 'utf8').trim() + '\n';

  const notes = [...byDate.values()].flat().length;
  return {
    markdown,
    summary: `${notes} note(s) over ${byDate.size} date(s) from ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}, + frozen archive`,
  };
}

// CLI: write FEATURES.md. Skipped when this module is imported.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { markdown, summary } = buildFeatures();
  fs.writeFileSync(path.join(repoRoot, 'FEATURES.md'), markdown);
  console.log(`FEATURES.md: ${summary}`);
}
