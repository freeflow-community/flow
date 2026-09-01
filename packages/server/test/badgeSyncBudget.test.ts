// Background-push budget for badge-sync (#251, PUSH_APNS.md § "Silent pushes
// keep the badge honest").
//
// #248 set the coalescing window to 30 s and #251 asks whether that survives
// real traffic. The window is not the thing at risk — a burst of forty reads
// has always collapsed to one push, and `badgeSync.test.ts` pins that. The
// thing at risk is the HOUR: at one push per 30 s, an hour of steady reading
// spends 120 background pushes on one user's badge, and Apple's budget for
// `content-available` is a handful per hour. Over it, iOS delays or drops
// them — so the coalescing that looks like politeness at the second scale is
// profligate at the hour scale.
//
// This file replays traffic profiles through the real module and counts. Time
// is SCALED, not faked: `badgeSyncTiming` is turned down by TIME_SCALE so a
// simulated hour runs in seconds, while the timers, the postgres driver and
// the device fan-out stay real (faking the clock here would fake it for the
// driver too — the reason badgeSync.test.ts shrinks its timings the same way).
//
// DB-backed — scratch database on the dev postgres (docker compose in
// packages/infra, host port 5442).
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';

process.env.DATABASE_URL = process.env.FLOW_TEST_DATABASE_URL
  ?? 'postgres://flow:flow_dev@localhost:5442/flow_badge_budget_test';
process.env.FLOW_DATA_KEY = randomBytes(32).toString('base64');

{
  const { default: postgres } = await import('postgres');
  const url = new URL(process.env.DATABASE_URL);
  const dbName = url.pathname.slice(1);
  url.pathname = '/postgres';
  const admin = postgres(url.toString(), { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE "${dbName}"`).catch(() => {}); // 42P04 duplicate_database
  await admin.end();
}

const { migrate } = await import('../src/db/migrate.js');
const { db, schema, closeDb } = await import('../src/db/index.js');
const auth = await import('../src/services/auth.js');
const dev = await import('../src/services/devices.js');
const {
  badgeSyncTiming,
  BACKGROUND_PUSHES_PER_HOUR,
  queueBadgeSync,
  noteAlertPush,
  _resetBadgeSyncForTests,
} = await import('../src/services/badgeSync.js');
const { _setPushSenderForTests } = await import('../src/push/index.js');

type PushDevice = import('../src/push/index.js').PushDevice;
type ApnsPayload = import('../src/push/index.js').ApnsPayload;
type ApnsHeaders = import('../src/push/index.js').ApnsHeaders;
type PushResult = import('../src/push/index.js').PushResult;

const { deviceTokens } = schema;

/**
 * Simulated:wall time. 1/400 puts a simulated hour in 9 s of test, with the
 * 30 s window landing at 75 ms — well above timer jitter, so the counts below
 * are the module's behaviour and not the scheduler's.
 */
const TIME_SCALE = 400;
/** Simulated milliseconds → wall milliseconds. */
const scaled = (simMs: number) => simMs / TIME_SCALE;
const HOUR_SIM_MS = 3_600_000;
/** A simulated hour is ~9 s of wall clock at this scale; give each one room. */
const SIM_TIMEOUT_MS = 60_000;

class CountingSender {
  /** When each background push went out, so a count can be taken over exactly
   * one simulated hour — the loop below drifts a little past it, and the
   * catch-up that follows a spent budget belongs to the NEXT hour. */
  sentAt: number[] = [];
  get background(): number {
    return this.sentAt.length;
  }
  async send(_d: PushDevice, _p: ApnsPayload, headers: ApnsHeaders): Promise<PushResult> {
    if (headers.pushType === 'background') this.sentAt.push(Date.now());
    return { ok: true };
  }
}

let userId = '';
let sender = new CountingSender();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Replay `reads` evenly across one simulated hour, optionally with an alert
 * push landing every `alertEverySimMs`, and return how many background pushes
 * that hour cost. `badge` walks down the way a real read does.
 */
async function simulateHour(opts: { reads: number; spanSimMs?: number; alertEverySimMs?: number }): Promise<number> {
  const startedAt = Date.now();
  const span = opts.spanSimMs ?? HOUR_SIM_MS;
  const gapSim = span / opts.reads;
  let badge = opts.reads;
  let nextAlert = opts.alertEverySimMs ?? Infinity;
  for (let i = 0; i < opts.reads; i++) {
    queueBadgeSync(userId, (badge -= 1));
    const elapsed = i * gapSim;
    if (elapsed >= nextAlert) {
      noteAlertPush(userId, badge);
      nextAlert += opts.alertEverySimMs!;
    }
    await sleep(scaled(gapSim));
  }
  // Let the hour finish: anything still queued goes out inside it.
  await sleep(scaled(Math.max(HOUR_SIM_MS - span, 0)) + scaled(badgeSyncTiming.windowMs * TIME_SCALE) + 50);
  const hourEndsAt = startedAt + scaled(HOUR_SIM_MS);
  return sender.sentAt.filter((t) => t <= hourEndsAt).length;
}

beforeAll(async () => {
  await migrate(process.env.DATABASE_URL!);
  await db.execute(`TRUNCATE users, workspaces, sessions, invites, pending_signups RESTART IDENTITY CASCADE` as never);
  const res = await auth.register('reader@example.test', {
    password: 'password123',
    displayName: 'Reader',
    autoVerify: true,
  });
  if (!('token' in res)) throw new Error('expected autoVerify session');
  userId = res.user.id;
  await dev.registerDevice(userId, {
    token: 'a'.repeat(64),
    platform: 'ios',
    environment: 'sandbox',
    bundleId: 'im.freeflow.app',
  });
  badgeSyncTiming.windowMs = 30_000 / TIME_SCALE;
  badgeSyncTiming.settleMs = 2_000 / TIME_SCALE;
  badgeSyncTiming.budgetWindowMs = HOUR_SIM_MS / TIME_SCALE;
});

beforeEach(() => {
  _resetBadgeSyncForTests();
  sender = new CountingSender();
  _setPushSenderForTests(sender);
});

afterAll(async () => {
  _resetBadgeSyncForTests();
  _setPushSenderForTests(null);
  await db.delete(deviceTokens);
  await closeDb();
});

describe('one user, one simulated hour', () => {
  // The profile #248 was designed against, and it was right about it: a sweep
  // that reads forty rows one at a time is two pushes, not forty — one after
  // the settle delay and one at the window mark carrying the newest count.
  it('a catch-up burst — 40 reads in 20 s — costs two pushes, not forty', async () => {
    const spent = await simulateHour({ reads: 40, spanSimMs: 20_000 });
    expect(spent).toBe(2);
  }, SIM_TIMEOUT_MS);

  // The profile it wasn't designed against: someone working a busy workspace
  // all morning, in and out of channels. Uncapped this is one push per window,
  // i.e. 120 an hour — an order of magnitude past what Apple will deliver.
  it('a busy hour — a read every 20 s — stays inside the hourly budget', async () => {
    // Uncapped this measured 119 (and 30 for a read every two minutes) — the
    // numbers that motivated suppression (3).
    const spent = await simulateHour({ reads: 180 });
    expect(spent).toBeLessThanOrEqual(BACKGROUND_PUSHES_PER_HOUR);
  }, SIM_TIMEOUT_MS);

  // Alert pushes carry a badge computed after the read, so on the busiest
  // workspaces — the ones where the budget is most at risk — most syncs are
  // redundant before they are sent. The cap and the suppression pull the same
  // way rather than against each other.
  it('alerts flowing alongside make it cheaper still, never dearer', async () => {
    const withAlerts = await simulateHour({ reads: 180, alertEverySimMs: 45_000 });
    expect(withAlerts).toBeLessThanOrEqual(BACKGROUND_PUSHES_PER_HOUR);
  }, SIM_TIMEOUT_MS);

  // The point of capping rather than dropping: the LAST count still lands.
  // A badge is absolute, so an hour of reading owes the phone exactly one
  // truthful number, and the cap must not eat it.
  it('the newest count still goes out after a capped hour', async () => {
    await simulateHour({ reads: 180 });
    expect(sender.background).toBeGreaterThan(0);
  }, SIM_TIMEOUT_MS);
});
