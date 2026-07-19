// Slack `ts` <-> UUIDv7 codec (phase4.md §1 "The ts problem").
//
// Slack identifies messages by channel + ts ("1726063573.123456"); MyChat uses
// UUIDv7 message ids. The mapping is DERIVED, not stored:
//
//   seconds  = the uuid's 48-bit millisecond timestamp / 1000
//   fraction = mmm (the millisecond remainder, 3 digits)
//            + the 12 random bits following the version nibble (hex digits
//              13-15 of the uuid, i.e. rand_a) rendered as value % 1000,
//              zero-padded to 3 digits
//
// giving a 6-digit fractional part. Deterministic and reversible with no
// storage: ts -> uuid is an index-backed range scan over the message ids that
// fall inside that millisecond, then an exact match on the derived ts.
//
// Documented caveats:
//  - rand_a % 1000 folds 4096 values onto 1000, and the bundled uuidv7
//    generator keeps rand_a constant within one millisecond (its monotonic
//    counter increments in rand_b), so two messages inserted into the same
//    channel in the same millisecond can derive the same ts. uuidFromTs
//    resolves ambiguity deterministically to the LOWEST matching id.
//  - ts order equals id order across milliseconds; within one millisecond the
//    derived ts is only weakly monotonic (see above).
import { and, eq, gte, lt } from 'drizzle-orm';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TS_RE = /^(\d{1,12})\.(\d{6})$/;

/** Derive the Slack ts string for a UUIDv7 message id. */
export function tsFromUuid(uuid: string): string {
  if (!UUID_RE.test(uuid)) throw new Error(`not a uuid: ${uuid}`);
  const hex = uuid.replace(/-/g, '').toLowerCase();
  const ms = parseInt(hex.slice(0, 12), 16); // 48-bit unix ms
  const randA = parseInt(hex.slice(13, 16), 16); // 12 bits after the version nibble
  const frac = String(ms % 1000).padStart(3, '0') + String(randA % 1000).padStart(3, '0');
  return `${Math.floor(ms / 1000)}.${frac}`;
}

/** Parse the unix-ms timestamp back out of a derived ts string (null if malformed). */
export function msFromTs(ts: string): number | null {
  const m = TS_RE.exec(ts);
  if (!m) return null;
  const ms = Number(m[1]) * 1000 + Number(m[2]!.slice(0, 3));
  return ms < 2 ** 48 ? ms : null;
}

/** Lower uuid bound for a millisecond: every UUIDv7 in ms m satisfies bound(m) <= id < bound(m+1). */
export function uuidBoundForMs(ms: number): string {
  const hex = ms.toString(16).padStart(12, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-0000-0000-000000000000`;
}

/** Exact-match a derived ts against candidate ids (lowest id wins on ties). */
export function matchTs(ids: readonly string[], ts: string): string | null {
  for (const id of ids) {
    if (tsFromUuid(id) === ts) return id;
  }
  return null;
}

/**
 * Reverse lookup: ts -> message uuid within a channel. Range-scans the
 * millisecond encoded in ts (primary-key range on messages.id, scoped to the
 * channel), then matches on the exact derived ts. Returns null when nothing
 * in that channel derives this ts.
 */
export async function uuidFromTs(channelId: string, ts: string): Promise<string | null> {
  const ms = msFromTs(ts);
  if (ms === null) return null;
  // dynamic import keeps the pure codec importable without a database (tests)
  const { db, schema } = await import('../db/index.js');
  const rows = await db
    .select({ id: schema.messages.id })
    .from(schema.messages)
    .where(
      and(
        eq(schema.messages.channelId, channelId),
        gte(schema.messages.id, uuidBoundForMs(ms)),
        lt(schema.messages.id, uuidBoundForMs(ms + 1)),
      ),
    )
    .orderBy(schema.messages.id);
  return matchTs(rows.map((r) => r.id), ts);
}
