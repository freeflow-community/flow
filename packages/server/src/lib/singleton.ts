// Phase 18 M1: replica-singleton jobs via Postgres advisory locks.
//
// A sweep that must run on at most one replica per round takes a
// `pg_try_advisory_lock` on a dedicated connection: the winner runs, every
// other replica skips that round and tries again next time. Session locks on
// a *dedicated* connection (not the pool) so the lock's lifetime is exactly
// the job's — a pooled connection could hand the session, and the lock, to an
// unrelated query. One extra connection per run is fine at sweep cadence
// (boot + daily).
//
// Keys are arbitrary bigints; they only need to be distinct within the
// database. Prefix 0x466c6f77 = "Flow".
import postgres from 'postgres';
import { config } from '../config.js';

export const LOCK_KEYS = {
  /** boot migrations — taken *blocking* inside db/migrate.ts */
  migrations: 0x466c6f7700000001n,
  /** daily orphan-file sweep (services/files.ts) */
  orphanSweep: 0x466c6f7700000002n,
  /** boot-time expired-session + stale-rate-window purge (index.ts) */
  bootPurge: 0x466c6f7700000003n,
} as const;

/**
 * Run `fn` iff no other replica currently holds `key`. Returns whether it
 * ran. Lock acquisition failure (e.g. the database is briefly unreachable)
 * counts as "didn't run" — every caller is a periodic job that retries by
 * cadence, never a correctness gate.
 */
export async function runExclusive<T>(
  key: bigint,
  fn: () => Promise<T>,
): Promise<{ ran: boolean; result?: T }> {
  let sql: postgres.Sql | null = null;
  try {
    sql = postgres(config.databaseUrl, { max: 1, onnotice: () => {} });
    // keys exceed Number.MAX_SAFE_INTEGER, so they travel as text + cast
    const rows = await sql`SELECT pg_try_advisory_lock(${key.toString()}::bigint) AS locked`;
    if (!rows[0]?.locked) return { ran: false };
  } catch {
    await sql?.end().catch(() => {});
    return { ran: false };
  }
  try {
    return { ran: true, result: await fn() };
  } finally {
    // closing the connection releases the session lock; the explicit unlock
    // just makes that not depend on end() succeeding
    await sql`SELECT pg_advisory_unlock(${key.toString()}::bigint)`.catch(() => {});
    await sql.end().catch(() => {});
  }
}
