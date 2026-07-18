// Minimal ordered .sql migration runner (schema is hand-written to stay
// byte-faithful to phase1.md §2 — drizzle-kit codegen can't express citext).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { config } from '../config.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export async function migrate(databaseUrl: string = config.databaseUrl): Promise<string[]> {
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  const applied: string[] = [];
  try {
    await sql`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
    )`;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files) {
      const done = await sql`SELECT 1 FROM schema_migrations WHERE name = ${f}`;
      if (done.length > 0) continue;
      const text = fs.readFileSync(path.join(dir, f), 'utf8');
      await sql.begin(async (tx) => {
        await tx.unsafe(text);
        await tx`INSERT INTO schema_migrations (name) VALUES (${f})`;
      });
      applied.push(f);
    }
  } finally {
    await sql.end();
  }
  return applied;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  migrate()
    .then((applied) => {
      console.log(applied.length ? `applied: ${applied.join(', ')}` : 'up to date');
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
