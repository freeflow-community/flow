// Phase 18 M1: fixed-window rate limiter backed by Postgres, for the limiter
// keys where one caller must be counted across replicas (the per-user keys —
// account deletion, invite redeem). The per-IP unauthenticated limits stay in
// lib/rateLimit.ts (in-memory; documented divergence, design doc §2).
//
// One atomic upsert per call: start a new window if the current one has
// lapsed, otherwise increment it. Fail-open on database error — this limiter
// guards abuse of cheap endpoints, and a limiter outage must not lock users
// out of legitimate actions.
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';

/** true = allowed. Same contract as lib/rateLimit.ts `rateAllow`. */
export async function rateAllowDb(key: string, limit: number, windowMs: number): Promise<boolean> {
  try {
    const rows = (await db.execute(sql`
      INSERT INTO rate_limit_windows (key, window_start, count)
      VALUES (${key}, now(), 1)
      ON CONFLICT (key) DO UPDATE SET
        count = CASE
          WHEN rate_limit_windows.window_start <= now() - (${windowMs} * interval '1 millisecond')
          THEN 1 ELSE rate_limit_windows.count + 1 END,
        window_start = CASE
          WHEN rate_limit_windows.window_start <= now() - (${windowMs} * interval '1 millisecond')
          THEN now() ELSE rate_limit_windows.window_start END
      RETURNING count
    `)) as unknown as { count: number }[];
    const count = rows[0]?.count;
    return count === undefined || count <= limit;
  } catch {
    return true;
  }
}

/** Boot-time housekeeping (behind the bootPurge singleton lock): windows are
 * minutes long, so anything older than a day is dead weight. */
export async function purgeStaleRateWindows(): Promise<void> {
  await db.execute(sql`DELETE FROM rate_limit_windows WHERE window_start < now() - interval '1 day'`);
}
