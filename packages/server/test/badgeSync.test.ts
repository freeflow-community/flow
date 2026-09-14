// Silent badge-sync pushes (#248). The properties worth pinning are the two
// suppressions, because both exist to protect a budget Apple takes away
// silently: reading forty rows must not send forty background pushes, and a
// badge already set by an alert must not be set again.
//
// Real timers, shrunk: `badgeSyncTiming` is turned down to tens of
// milliseconds for the suite. Faking the clock instead would fake it for the
// postgres driver in the same process, and the device fan-out below is a real
// query.
//
// DB-backed (the device fan-out is a real query) — scratch database on the dev
// postgres (docker compose in packages/infra, host port 5442).
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';

process.env.DATABASE_URL = process.env.FLOW_TEST_DATABASE_URL
  ?? 'postgres://flow:flow_dev@localhost:5442/flow_badge_sync_test';
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

// dynamic imports so the env above is set before config/db read it
const { migrate } = await import('../src/db/migrate.js');
const { db, schema, closeDb } = await import('../src/db/index.js');
const auth = await import('../src/services/auth.js');
const ws = await import('../src/services/workspaces.js');
const ch = await import('../src/services/channels.js');
const msg = await import('../src/services/messages.js');
const dev = await import('../src/services/devices.js');
const nt = await import('../src/services/notifications.js');
const outbox = await import('../src/services/pushOutbox.js');
const { badgeSyncTiming, queueBadgeSync, noteAlertPush, _resetBadgeSyncForTests } =
  await import('../src/services/badgeSync.js');
const { _setPushSenderForTests } = await import('../src/push/index.js');

type PushDevice = import('../src/push/index.js').PushDevice;
type ApnsPayload = import('../src/push/index.js').ApnsPayload;
type ApnsHeaders = import('../src/push/index.js').ApnsHeaders;
type PushResult = import('../src/push/index.js').PushResult;

const { deviceTokens, notifications, pendingPush } = schema;

const log = { info: () => {}, warn: () => {} };

class FakeSender {
  sent: Array<{ device: PushDevice; payload: ApnsPayload; headers: ApnsHeaders }> = [];
  constructor(private readonly reply: () => PushResult = () => ({ ok: true })) {}
  async send(device: PushDevice, payload: ApnsPayload, headers: ApnsHeaders): Promise<PushResult> {
    this.sent.push({ device, payload, headers });
    return this.reply();
  }
  get silent() {
    return this.sent.filter((s) => s.headers.pushType === 'background');
  }
}

let sender = new FakeSender();
let aliceId = '';
let bobId = '';
let workspaceId = '';
let channelId = '';

const SETTLE_MS = 50;
const WINDOW_MS = 400;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Wait past the settle delay (plus slack) so a scheduled flush has run. */
const settle = () => sleep(SETTLE_MS * 4);
/** Wait out the whole throttle window. */
const window_ = () => sleep(WINDOW_MS + SETTLE_MS * 4);

async function registerHuman(email: string, name: string): Promise<string> {
  const res = await auth.register(email, { password: 'password123', displayName: name, autoVerify: true });
  if (!('token' in res)) throw new Error('expected autoVerify session');
  return res.user.id;
}

beforeAll(async () => {
  await migrate(process.env.DATABASE_URL!);
  await db.execute(`TRUNCATE users, workspaces, sessions, invites, pending_signups RESTART IDENTITY CASCADE` as never);
  aliceId = await registerHuman('alice@example.test', 'Alice');
  bobId = await registerHuman('bob@example.test', 'Bob');
  const w = await ws.createWorkspace(aliceId, 'Badge Sync Test', `badge-${randomUUID().slice(0, 8)}`);
  workspaceId = w.id;
  await db.insert(schema.workspaceMembers).values({ workspaceId, userId: bobId, role: 'member' });
  const chan = await ch.createChannel(workspaceId, aliceId, 'alerts');
  channelId = chan.id;
  await ch.addMember(channelId, aliceId, bobId);
  badgeSyncTiming.settleMs = SETTLE_MS;
  badgeSyncTiming.windowMs = WINDOW_MS;
});

beforeEach(async () => {
  await db.delete(pendingPush);
  await db.delete(notifications);
  await db.delete(deviceTokens);
  _resetBadgeSyncForTests();
  sender = new FakeSender();
  _setPushSenderForTests(sender);
  await dev.registerDevice(bobId, {
    token: 'b'.repeat(64),
    platform: 'ios',
    environment: 'sandbox',
    bundleId: 'im.freeflow.app',
  });
});

afterAll(async () => {
  _setPushSenderForTests(null);
  _resetBadgeSyncForTests();
  badgeSyncTiming.settleMs = 2_000;
  badgeSyncTiming.windowMs = 30_000;
  await closeDb();
});

describe('the silent push', () => {
  it('carries the count and nothing else', async () => {
    queueBadgeSync(bobId, 4);
    await settle();
    expect(sender.silent).toHaveLength(1);
    const { payload, headers } = sender.silent[0]!;
    expect(payload).toEqual({ aps: { badge: 4, 'content-available': 1 } });
    expect(payload.aps.alert).toBeUndefined();
    expect(payload.aps.sound).toBeUndefined();
    expect(headers.pushType).toBe('background');
    expect(headers.priority).toBe(5);
  });

  it('goes to every live device and skips the disabled ones', async () => {
    await dev.registerDevice(bobId, { token: 'c'.repeat(64), platform: 'ios', environment: 'sandbox', bundleId: 'im.freeflow.app' });
    await dev.registerDevice(bobId, { token: 'd'.repeat(64), platform: 'ios', environment: 'sandbox', bundleId: 'im.freeflow.app' });
    await db.update(deviceTokens).set({ disabledAt: new Date() }).where(eq(deviceTokens.token, 'd'.repeat(64)));
    queueBadgeSync(bobId, 2);
    await settle();
    expect(sender.silent.map((s) => s.device.token).sort()).toEqual(['b'.repeat(64), 'c'.repeat(64)]);
  });

  it('sends nothing for a user with no live device', async () => {
    await db.delete(deviceTokens);
    queueBadgeSync(bobId, 0);
    await settle();
    expect(sender.silent).toHaveLength(0);
  });
});

describe('coalescing (suppression 1: Apple meters background pushes)', () => {
  it('collapses a burst of reads into one push carrying the newest count', async () => {
    for (const n of [9, 5, 3, 0]) queueBadgeSync(bobId, n);
    await settle();
    expect(sender.silent).toHaveLength(1);
    expect(sender.silent[0]!.payload.aps.badge).toBe(0);
  });

  it('holds the next one until the window elapses, then sends it', async () => {
    queueBadgeSync(bobId, 5);
    await settle();
    expect(sender.silent).toHaveLength(1);

    queueBadgeSync(bobId, 4);
    await settle();
    expect(sender.silent).toHaveLength(1); // still inside the window

    await window_();
    expect(sender.silent).toHaveLength(2);
    expect(sender.silent[1]!.payload.aps.badge).toBe(4);
  });

  it('sends immediately again once the window has passed quietly', async () => {
    queueBadgeSync(bobId, 5);
    await settle();
    await window_();
    queueBadgeSync(bobId, 1);
    await settle();
    expect(sender.silent).toHaveLength(2);
  });

  it('throttles each user separately', async () => {
    await dev.registerDevice(aliceId, { token: 'e'.repeat(64), platform: 'ios', environment: 'sandbox', bundleId: 'im.freeflow.app' });
    queueBadgeSync(bobId, 3);
    queueBadgeSync(aliceId, 8);
    await settle();
    expect(sender.silent).toHaveLength(2);
    expect(sender.silent.map((s) => s.payload.aps.badge).sort()).toEqual([3, 8]);
  });
});

describe('redundancy (suppression 2: an alert already set this badge)', () => {
  it('drops the sync when an alert carried the same count after it was queued', async () => {
    queueBadgeSync(bobId, 7);
    noteAlertPush(bobId, 7);
    await settle();
    expect(sender.silent).toHaveLength(0);
  });

  it('drops it for a later alert carrying a different count too — that one is fresher', async () => {
    queueBadgeSync(bobId, 7);
    noteAlertPush(bobId, 8);
    await settle();
    expect(sender.silent).toHaveLength(0);
  });

  it('still sends when the alert predates the read it is answering', async () => {
    noteAlertPush(bobId, 7);
    await sleep(5);
    queueBadgeSync(bobId, 7); // a later read that happens to land on the same total
    await settle();
    expect(sender.silent).toHaveLength(1);
  });
});

describe('wired to the read paths', () => {
  it('mirrors notification.read to the phone', async () => {
    await msg.sendMessage(channelId, aliceId, randomUUID(), `ping <@${bobId}>`, undefined, undefined, [bobId]);
    const note = (await db.select().from(notifications))[0]!;
    sender.sent.length = 0;

    await nt.markNotificationsRead(bobId, { id: note.id });
    await settle();
    expect(sender.silent).toHaveLength(1);
    expect(sender.silent[0]!.payload.aps.badge).toBe(0);
  });

  it('says nothing when an alert push landed after the read', async () => {
    // Bob reads his one mention, and a second mention is delivered before the
    // sync settles: that alert already told the phone the new number. The
    // settle delay is widened for this one case so the send-and-drain in the
    // middle is comfortably inside it — in production it is 2 s against a
    // worker that ticks every second.
    badgeSyncTiming.settleMs = 1_000;
    try {
      await msg.sendMessage(channelId, aliceId, randomUUID(), `first <@${bobId}>`, undefined, undefined, [bobId]);
      const note = (await db.select().from(notifications))[0]!;
      await nt.markNotificationsRead(bobId, { id: note.id });
      await msg.sendMessage(channelId, aliceId, randomUUID(), `second <@${bobId}>`, undefined, undefined, [bobId]);
      await outbox.drainPendingPush(log);
      await sleep(1_400);

      expect(sender.sent.filter((s) => s.headers.pushType === 'alert').length).toBeGreaterThan(0);
      expect(sender.silent).toHaveLength(0);
    } finally {
      badgeSyncTiming.settleMs = SETTLE_MS;
    }
  });
});
