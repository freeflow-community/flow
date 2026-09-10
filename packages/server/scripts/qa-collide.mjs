#!/usr/bin/env node
// Give two independent QA backends *deliberately colliding* identifiers.
//
// The multi-server acceptance matrix is run "with two independent backends
// with deliberately overlapping user, workspace, channel, and file IDs"
// (docs/specs/multi-server-workspaces.md, "Delivery and acceptance"). Two
// separately seeded databases never collide on their own — every id is a fresh
// UUIDv7 — so nothing here would catch a cache, a query key or a push route
// that identifies a row by its id alone and forgets which server it came from.
//
// This rewrites a seeded database's ids to values *derived from the row's
// natural key*: alice@qa.local is the same UUID on every backend this runs
// against, and so are the qa-lab workspace and its #general channel. It is
// deterministic and needs no coordination between the two stacks — run it on
// each one and they collide.
//
// It rewrites primary keys, so it walks the foreign keys pointing at them:
// drop the constraints (keeping their definitions), update parent and children,
// put the constraints back. Only ever pointed at a throwaway `flow_qa_*`
// database, which it checks before touching anything.
//
// Usage: node scripts/qa-collide.mjs --database-url postgres://…/flow_qa_5051
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const value = (name) => {
  const inline = args.find((a) => a.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};

const databaseUrl = value('database-url') ?? process.env.DATABASE_URL;
if (!databaseUrl || args.includes('--help')) {
  console.error('usage: qa-collide.mjs --database-url postgres://…/flow_qa_<port>');
  process.exit(args.includes('--help') ? 0 : 1);
}

const dbName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
if (!/^flow_qa_\d+$/.test(dbName) && !args.includes('--force')) {
  console.error(`qa-collide: ${dbName} is not a qa:up database — refusing. (--force overrides)`);
  process.exit(1);
}

/** A UUID derived from a name: stable across machines, runs and backends.
 *
 * Shaped like a v7 so it sorts and validates like every other id in the
 * database — the timestamp is a fixed date plus a hash-derived offset rather
 * than "now", because two backends must agree on it. */
function collidingId(name) {
  const digest = createHash('sha256').update(`flow-qa-collision:${name}`).digest();
  const BASE_MS = Date.UTC(2026, 0, 1);
  const millis = BASE_MS + digest.readUInt32BE(0) % 86_400_000;
  const hex = millis.toString(16).padStart(12, '0') + digest.subarray(4, 14).toString('hex');
  const bytes = Buffer.from(hex, 'hex');
  bytes[6] = (bytes[6] & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const s = bytes.toString('hex');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

const require = createRequire(path.join(serverDir, 'package.json'));
const mod = await import(pathToFileURL(require.resolve('postgres')).href);
const sql = (mod.default ?? mod)(databaseUrl, { max: 1, onnotice: () => {} });

/** Every FK column pointing at `table.id`, so a primary key can be rewritten. */
async function referencesTo(table) {
  return sql`
    SELECT con.conname AS name,
           con.conrelid::regclass::text AS child,
           att.attname AS column,
           pg_get_constraintdef(con.oid) AS definition
      FROM pg_constraint con
      JOIN unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
      JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum
     WHERE con.contype = 'f' AND con.confrelid = ${table}::regclass`;
}

/** `natural key -> new id` for one table, built from the rows that are there. */
async function plan(table, rows) {
  const map = new Map();
  for (const row of rows) {
    const next = collidingId(`${table}:${row.key}`);
    if (row.id !== next) map.set(row.id, next);
  }
  return map;
}

async function rewrite(table, map) {
  if (!map.size) return 0;
  const refs = await referencesTo(table);
  for (const ref of refs) await sql.unsafe(`ALTER TABLE ${ref.child} DROP CONSTRAINT "${ref.name}"`);
  try {
    for (const [from, to] of map) {
      await sql.unsafe(`UPDATE ${table} SET id = $1 WHERE id = $2`, [to, from]);
      for (const ref of refs) {
        await sql.unsafe(`UPDATE ${ref.child} SET "${ref.column}" = $1 WHERE "${ref.column}" = $2`, [to, from]);
      }
    }
  } finally {
    for (const ref of refs) {
      await sql.unsafe(`ALTER TABLE ${ref.child} ADD CONSTRAINT "${ref.name}" ${ref.definition}`);
    }
  }
  return map.size;
}

try {
  const summary = {};
  // Users and workspaces key off values a human chose (email, slug). Channels
  // and files key off their name *within* the already-collided workspace, so
  // #general on both backends is one id and two different conversations.
  summary.users = await rewrite('users', await plan('users',
    (await sql`SELECT id, email AS key FROM users`).map((r) => ({ id: r.id, key: r.key }))));
  summary.workspaces = await rewrite('workspaces', await plan('workspaces',
    (await sql`SELECT id, slug AS key FROM workspaces`).map((r) => ({ id: r.id, key: r.key }))));
  summary.channels = await rewrite('channels', await plan('channels',
    (await sql`SELECT id, workspace_id || '/' || coalesce(name, '') AS key FROM channels WHERE name IS NOT NULL`)
      .map((r) => ({ id: r.id, key: r.key }))));
  summary.files = await rewrite('files', await plan('files',
    (await sql`SELECT id, workspace_id || '/' || name AS key FROM files`).map((r) => ({ id: r.id, key: r.key }))));
  console.log(JSON.stringify({ database: dbName, rewritten: summary }, null, 2));
} finally {
  await sql.end();
}
