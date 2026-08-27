// Built-in help docs (#383): markdown files checked into the repo at
// `docs/help/`, served raw over the API so every client renders them with its
// own markdown pipeline (web now, macOS in #384).
//
// The set of topics is derived from the directory — dropping in a new .md with
// front-matter makes it appear in every client with no client change. Files are
// read per request: there are a handful of them, and it means an edit shows up
// without a restart in dev.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HelpPageDTO, HelpTopicDTO } from '@flow/shared';
import { notFound } from '../lib/errors.js';

/** Repo-root `docs/help`. This file sits at packages/server/{src,dist}/services,
 * so four levels up is the repo root under tsx and under the compiled build
 * alike (Railway deploys the whole repo — see railway.json). */
const HELP_DIR =
  process.env.FLOW_HELP_DIR ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../docs/help');

/** A slug is a file name, so it must never be able to escape the help dir. */
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

/** Minimal front-matter: a leading `---` block of `key: value` lines. Only
 * `title` and `order` are read; everything else is ignored. */
export function parseFrontMatter(source: string): { meta: Record<string, string>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!match) return { meta: {}, body: source };
  const meta: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line.trim());
    if (kv) meta[kv[1]!.toLowerCase()] = kv[2]!.trim().replace(/^["']|["']$/g, '');
  }
  return { meta, body: source.slice(match[0].length) };
}

function readTopic(slug: string): { topic: HelpTopicDTO; body: string } | null {
  let source: string;
  try {
    source = fs.readFileSync(path.join(HELP_DIR, `${slug}.md`), 'utf8');
  } catch {
    return null;
  }
  const { meta, body } = parseFrontMatter(source);
  const order = Number.parseInt(meta.order ?? '', 10);
  return {
    topic: {
      slug,
      // A file with no `title:` still gets a usable one rather than vanishing.
      title: meta.title || slug.replace(/-/g, ' '),
      order: Number.isFinite(order) ? order : 100,
    },
    body,
  };
}

/** Every topic, in sidebar order (`order:` front-matter, then slug). */
export function listTopics(): HelpTopicDTO[] {
  let files: string[];
  try {
    files = fs.readdirSync(HELP_DIR);
  } catch {
    return [];
  }
  const topics = files
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.slice(0, -3))
    .filter((slug) => SLUG_RE.test(slug))
    .map((slug) => readTopic(slug)?.topic)
    .filter((t): t is HelpTopicDTO => t !== undefined);
  return topics.sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));
}

/** Raw markdown for one topic — front-matter stripped. 404 if there is no such file. */
export function getPage(slug: string): HelpPageDTO {
  if (!SLUG_RE.test(slug)) throw notFound('no such help page');
  const found = readTopic(slug);
  if (!found) throw notFound('no such help page');
  return { slug, title: found.topic.title, markdown: found.body.trim() + '\n' };
}
