// APNs delivery outbox (#247). The properties worth pinning are the ones an
// outbox exists for: the row commits with the notification or not at all, the
// worker drains at least once across a restart, failures retry with backoff and
// eventually stop, and the fan-out to devices happens at SEND time from one row
// per notification — not one row per device.
//
// DB-backed — scratch database on the dev postgres (docker compose in
// packages/infra, host port 5442). The drain is driven directly rather than by
// waiting on the 1s interval: what matters is the claim-and-resolve semantics,
// not the timer.
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';

process.env.DATABASE_URL = process.env.FLOW_TEST_DATABASE_URL
  ?? 'postgres://flow:flow_dev@localhost:5442/flow_push_outbox_test';
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
const rx = await import('../src/services/reactions.js');
const dev = await import('../src/services/devices.js');
const outbox = await import('../src/services/pushOutbox.js');
const { _setPushSenderForTests } = await import('../src/push/index.js');
const { ApnsHttp2PushSender } = await import('../src/push/apnsSender.js');
const { closeApnsSessions } = await import('../src/push/apnsClient.js');
const http2 = await import('node:http2');
const { newId } = await import('../src/lib/ids.js');
const { desc, eq } = await import('drizzle-orm');

type PushDevice = import('../src/push/index.js').PushDevice;
type ApnsPayload = import('../src/push/index.js').ApnsPayload;
type ApnsHeaders = import('../src/push/index.js').ApnsHeaders;
type PushResult = import('../src/push/index.js').PushResult;

const { deviceTokens, notifications, pendingPush } = schema;

const log = { info: () => {}, warn: () => {} };

/** Records every send and answers with whatever the test queued. */
class FakeSender {
  sent: Array<{ device: PushDevice; payload: ApnsPayload; headers: ApnsHeaders }> = [];
  constructor(private readonly reply: (n: number) => PushResult | Error = () => ({ ok: true })) {}
  async send(device: PushDevice, payload: ApnsPayload, headers: ApnsHeaders): Promise<PushResult> {
    this.sent.push({ device, payload, headers });
    const r = this.reply(this.sent.length);
    if (r instanceof Error) throw r;
    return r;
  }
}

function useSender(reply?: (n: number) => PushResult | Error): FakeSender {
  const s = new FakeSender(reply);
  _setPushSenderForTests(s);
  return s;
}

const OK: PushResult = { ok: true };
const RETRYABLE: PushResult = { ok: false, status: 503, reason: 'ServiceUnavailable', retryable: true, disableDevice: false };
const GONE: PushResult = { ok: false, status: 410, reason: 'Unregistered', retryable: false, disableDevice: true };

let aliceId = ''; // author, no devices of her own
let bobId = ''; // recipient, the one with phones
let workspaceId = '';
let channelId = '';

async function registerHuman(email: string, name: string): Promise<string> {
  const res = await auth.register(email, { password: 'password123', displayName: name, autoVerify: true });
  if (!('token' in res)) throw new Error('expected autoVerify session');
  return res.user.id;
}

async function addDevice(userId: string, token: string): Promise<void> {
  await dev.registerDevice(userId, { token, platform: 'ios', environment: 'sandbox', bundleId: 'im.freeflow.app' });
}

/** Mention bob so exactly one notification (and so one push) is raised. */
async function mentionBob(text = `hi <@${bobId}>`) {
  return msg.sendMessage(channelId, aliceId, randomUUID(), text, undefined, undefined, [bobId]);
}

const pushRows = async (userId = bobId) =>
  db.select().from(pendingPush).where(eq(pendingPush.userId, userId)).orderBy(pendingPush.id);

/** Make every unresolved row due now — the "the backoff elapsed" fast-forward. */
const makeDue = () => db.update(pendingPush).set({ nextAttemptAt: new Date(Date.now() - 1_000) });

beforeAll(async () => {
  await migrate(process.env.DATABASE_URL!);
  await db.execute(`TRUNCATE users, workspaces, sessions, invites, pending_signups RESTART IDENTITY CASCADE` as never);
  aliceId = await registerHuman('alice@example.test', 'Alice');
  bobId = await registerHuman('bob@example.test', 'Bob');
  const w = await ws.createWorkspace(aliceId, 'Push Outbox Test', `push-${randomUUID().slice(0, 8)}`);
  workspaceId = w.id;
  await db.insert(schema.workspaceMembers).values({ workspaceId, userId: bobId, role: 'member' });
  const chan = await ch.createChannel(workspaceId, aliceId, 'alerts');
  channelId = chan.id;
  await ch.addMember(channelId, aliceId, bobId);
});

beforeEach(async () => {
  await db.delete(pendingPush);
  await db.delete(notifications);
  await db.delete(deviceTokens);
  _setPushSenderForTests(null);
});

afterAll(async () => {
  _setPushSenderForTests(null);
  await closeDb();
});

describe('enqueue rides the notification transaction', () => {
  it('writes one pending_push row per notification for a user with a device', async () => {
    await addDevice(bobId, 'a'.repeat(64));
    const m = await mentionBob();
    const rows = await pushRows();
    expect(rows).toHaveLength(1);
    const note = (await db.select().from(notifications).where(eq(notifications.messageId, m.id)))[0];
    expect(rows[0]!.notificationId).toBe(note!.id);
    expect(rows[0]!.attempts).toBe(0);
    expect(rows[0]!.deliveredAt).toBeNull();
  });

  it('writes nothing for a recipient with no live device', async () => {
    await mentionBob();
    expect(await pushRows()).toHaveLength(0);
    // ...and the notification itself is untouched by that decision
    expect(await db.select().from(notifications).where(eq(notifications.userId, bobId))).toHaveLength(1);
  });

  it('skips a device APNs already disabled', async () => {
    await addDevice(bobId, 'a'.repeat(64));
    await db.update(deviceTokens).set({ disabledAt: new Date() });
    await mentionBob();
    expect(await pushRows()).toHaveLength(0);
  });

  it('rolls back with the notification when the transaction fails', async () => {
    await addDevice(bobId, 'a'.repeat(64));
    const m = await mentionBob();
    await db.delete(pendingPush);
    await db.delete(notifications);

    const nt = await import('../src/services/notifications.js');
    await expect(
      db.transaction(async (tx) => {
        await nt.insertNotifications(tx, new Map([[bobId, { kind: 0 as const, subkind: 'mention' as const }]]), m.id, channelId, aliceId);
        // the notification row and its push row both exist right now...
        expect(await tx.select().from(pendingPush)).toHaveLength(1);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    // ...and neither survives the rollback. A committed notification with no
    // outbox row would be a push nothing can recover, since a phone with no
    // socket has nothing to backfill from.
    expect(await db.select().from(notifications)).toHaveLength(0);
    expect(await db.select().from(pendingPush)).toHaveLength(0);
  });

  it('enqueues for a reaction (kind 4), whose insert had to be wrapped in a tx', async () => {
    await addDevice(bobId, 'a'.repeat(64));
    const m = await msg.sendMessage(channelId, bobId, randomUUID(), 'bob says hi');
    await db.delete(pendingPush); // ignore anything bob's own message raised
    await rx.addReaction(m.id, aliceId, '👍');
    const rows = await pushRows();
    expect(rows).toHaveLength(1);
    const note = (await db.select().from(notifications).where(eq(notifications.userId, bobId)).orderBy(desc(notifications.id)).limit(1))[0];
    expect(note!.kind).toBe(4);
    expect(rows[0]!.notificationId).toBe(note!.id);
  });

  it('does not enqueue twice for a repeated reaction the notification suppressed', async () => {
    await addDevice(bobId, 'a'.repeat(64));
    const m = await msg.sendMessage(channelId, bobId, randomUUID(), 'bob says hi');
    await db.delete(pendingPush);
    await rx.addReaction(m.id, aliceId, '👍');
    await rx.removeReaction(m.id, aliceId, '👍');
    await rx.addReaction(m.id, aliceId, '👍'); // ON CONFLICT DO NOTHING on the notification
    expect(await pushRows()).toHaveLength(1);
  });
});

describe('the worker drains', () => {
  it('sends and marks the row delivered', async () => {
    await addDevice(bobId, 'a'.repeat(64));
    const sender = useSender();
    await mentionBob();

    expect(await outbox.drainPendingPush(log)).toBe(1);
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]!.device.token).toBe('a'.repeat(64));
    expect(sender.sent[0]!.headers.pushType).toBe('alert');
    const rows = await pushRows();
    expect(rows[0]!.deliveredAt).not.toBeNull();
    expect(rows[0]!.failedAt).toBeNull();

    // a delivered row is not re-sent
    expect(await outbox.drainPendingPush(log)).toBe(0);
    expect(sender.sent).toHaveLength(1);
  });

  it('carries the notification routing keys and the badge count', async () => {
    await addDevice(bobId, 'a'.repeat(64));
    const sender = useSender();
    await mentionBob();
    await mentionBob('and again <@' + bobId + '>');
    await outbox.drainPendingPush(log);

    expect(sender.sent).toHaveLength(2);
    const last = sender.sent[1]!.payload;
    expect(last.channelId).toBe(channelId);
    expect(last.workspaceId).toBe(workspaceId);
    expect(typeof last.notificationId).toBe('string');
    // server-authoritative unread total: bob has two unread rows by now
    expect(last.aps.badge).toBe(2);
    expect(last.aps['thread-id']).toBe(channelId);
  });
});

describe('one row per notification, fanned out at send time', () => {
  it('sends to a device registered after the row was enqueued', async () => {
    await addDevice(bobId, 'a'.repeat(64));
    const sender = useSender();
    await mentionBob();
    expect(await pushRows()).toHaveLength(1);

    // the second phone arrives between commit and delivery
    await addDevice(bobId, 'b'.repeat(64));
    await outbox.drainPendingPush(log);

    expect(await pushRows()).toHaveLength(1); // still ONE row
    expect(sender.sent.map((s) => s.device.token).sort()).toEqual(['a'.repeat(64), 'b'.repeat(64)]);
    // one badge computation shared by both phones, not one per device
    expect(new Set(sender.sent.map((s) => s.payload.aps.badge))).toEqual(new Set([1]));
  });

  it('resolves a row whose devices all went away before delivery', async () => {
    await addDevice(bobId, 'a'.repeat(64));
    const sender = useSender();
    await mentionBob();
    await dev.unregisterDevice(bobId, 'a'.repeat(64));

    await outbox.drainPendingPush(log);
    expect(sender.sent).toHaveLength(0);
    const rows = await pushRows();
    expect(rows[0]!.deliveredAt).not.toBeNull(); // nothing owed — done, not failed
  });

  it('counts one delivery when one of two phones takes it', async () => {
    await addDevice(bobId, 'a'.repeat(64));
    await addDevice(bobId, 'b'.repeat(64));
    // second phone times out; retrying the row would re-push to the first
    const sender = useSender((n) => (n === 1 ? OK : RETRYABLE));
    await mentionBob();

    expect(await outbox.drainPendingPush(log)).toBe(1);
    expect(sender.sent).toHaveLength(2);
    expect((await pushRows())[0]!.deliveredAt).not.toBeNull();
  });
});

describe('retry, backoff, and giving up', () => {
  it('backs off instead of failing on a retryable rejection', async () => {
    await addDevice(bobId, 'a'.repeat(64));
    useSender(() => RETRYABLE);
    await mentionBob();

    const before = Date.now();
    await outbox.drainPendingPush(log);
    const row = (await pushRows())[0]!;
    expect(row.attempts).toBe(1);
    expect(row.failedAt).toBeNull();
    expect(row.deliveredAt).toBeNull();
    // first backoff is 5s — and the row is not due again before then
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(before + 4_000);
    expect(await outbox.drainPendingPush(log)).toBe(0);
  });

  it('treats a driver that throws as transient, not as a rejection', async () => {
    await addDevice(bobId, 'a'.repeat(64));
    useSender(() => new Error('http2 GOAWAY'));
    await mentionBob();
    await outbox.drainPendingPush(log);
    const row = (await pushRows())[0]!;
    expect(row.attempts).toBe(1);
    expect(row.failedAt).toBeNull();
  });

  it('recovers when the next attempt succeeds', async () => {
    await addDevice(bobId, 'a'.repeat(64));
    const sender = useSender((n) => (n === 1 ? RETRYABLE : OK));
    await mentionBob();
    await outbox.drainPendingPush(log);
    await makeDue();
    expect(await outbox.drainPendingPush(log)).toBe(1);
    expect(sender.sent).toHaveLength(2);
    expect((await pushRows())[0]!.deliveredAt).not.toBeNull();
  });

  it('stops after MAX_ATTEMPTS (4, as in appEvents)', async () => {
    await addDevice(bobId, 'a'.repeat(64));
    const sender = useSender(() => RETRYABLE);
    await mentionBob();
    for (let i = 0; i < 6; i++) {
      await makeDue();
      await outbox.drainPendingPush(log);
    }
    const row = (await pushRows())[0]!;
    expect(row.attempts).toBe(4);
    expect(row.failedAt).not.toBeNull();
    expect(sender.sent).toHaveLength(4); // 1 initial + 3 retries, then no more
  });

  it('fails immediately on a non-retryable rejection', async () => {
    await addDevice(bobId, 'a'.repeat(64));
    useSender(() => ({ ok: false, status: 400, reason: 'PayloadTooLarge', retryable: false, disableDevice: false }));
    await mentionBob();
    await outbox.drainPendingPush(log);
    const row = (await pushRows())[0]!;
    expect(row.attempts).toBe(1);
    expect(row.failedAt).not.toBeNull(); // no retries burned on a bug
  });
});

describe('device disabling', () => {
  it('disables the token APNs says is gone (410), keeping the row for a re-register', async () => {
    await addDevice(bobId, 'a'.repeat(64));
    useSender(() => GONE);
    await mentionBob();
    await outbox.drainPendingPush(log);

    const [device] = await db.select().from(deviceTokens).where(eq(deviceTokens.userId, bobId));
    expect(device!.disabledAt).not.toBeNull();
    expect((await pushRows())[0]!.failedAt).not.toBeNull();

    // the phone that comes back re-registers on cold start and is live again
    await addDevice(bobId, 'a'.repeat(64));
    expect((await db.select().from(deviceTokens).where(eq(deviceTokens.userId, bobId)))[0]!.disabledAt).toBeNull();
  });

  it('auto-disables a user\'s devices after sustained failure', async () => {
    await addDevice(bobId, 'a'.repeat(64));
    useSender(() => RETRYABLE);
    // five notifications, each driven to permanent failure — the appEvents
    // AUTO_DISABLE_AFTER shape, keyed on the user instead of an app endpoint.
    for (let n = 0; n < 5; n++) {
      await mentionBob(`ping ${n} <@${bobId}>`);
      for (let i = 0; i < 4; i++) {
        await makeDue();
        await outbox.drainPendingPush(log);
      }
    }
    const rows = await pushRows();
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.failedAt !== null)).toBe(true);
    const [device] = await db.select().from(deviceTokens).where(eq(deviceTokens.userId, bobId));
    expect(device!.disabledAt).not.toBeNull();
  });

  it('leaves devices alone while failures are not yet sustained', async () => {
    await addDevice(bobId, 'a'.repeat(64));
    useSender(() => RETRYABLE);
    for (let n = 0; n < 3; n++) {
      await mentionBob(`ping ${n} <@${bobId}>`);
      for (let i = 0; i < 4; i++) {
        await makeDue();
        await outbox.drainPendingPush(log);
      }
    }
    const [device] = await db.select().from(deviceTokens).where(eq(deviceTokens.userId, bobId));
    expect(device!.disabledAt).toBeNull();
  });
});

describe('at-least-once across a restart', () => {
  it('delivers a row left claimed by a replica that died mid-batch', async () => {
    await addDevice(bobId, 'a'.repeat(64));
    const note = await (async () => {
      await mentionBob();
      return (await db.select().from(notifications).where(eq(notifications.userId, bobId)))[0]!;
    })();
    // The replica claimed the row (lease pushed 120s out) and then died before
    // resolving it. Nothing marks the row; the lease simply lapses.
    await db.delete(pendingPush);
    await db.insert(pendingPush).values({
      id: newId(),
      userId: bobId,
      notificationId: note.id,
      nextAttemptAt: new Date(Date.now() - 1_000), // lease expired
    });

    const sender = useSender();
    expect(await outbox.drainPendingPush(log)).toBe(1);
    expect(sender.sent).toHaveLength(1);
    const row = (await pushRows())[0]!;
    expect(row.deliveredAt).not.toBeNull();
    expect(row.attempts).toBe(0); // a dead replica costs no attempts
  });

  it('does not touch a row another drain is holding a live lease on', async () => {
    await addDevice(bobId, 'a'.repeat(64));
    const note = (await (async () => {
      await mentionBob();
      return db.select().from(notifications).where(eq(notifications.userId, bobId));
    })())[0]!;
    await db.delete(pendingPush);
    await db.insert(pendingPush).values({
      id: newId(),
      userId: bobId,
      notificationId: note.id,
      nextAttemptAt: new Date(Date.now() + 60_000), // in-flight elsewhere
    });

    const sender = useSender();
    expect(await outbox.drainPendingPush(log)).toBe(0);
    expect(sender.sent).toHaveLength(0);
  });

  it('a hard-deleted notification takes its pending push with it', async () => {
    await addDevice(bobId, 'a'.repeat(64));
    await mentionBob();
    const rows = await pushRows();
    expect(rows).toHaveLength(1);
    await db.delete(notifications).where(eq(notifications.id, rows[0]!.notificationId));
    // never push a notification that no longer exists — the FK cascade is what
    // guarantees it, so the worker never even sees the row.
    expect(await pushRows()).toHaveLength(0);
    const sender = useSender();
    expect(await outbox.drainPendingPush(log)).toBe(0);
    expect(sender.sent).toHaveLength(0);
  });
});

describe('worker lifecycle', () => {
  it('startPushWorker is idempotent and stoppable', async () => {
    await addDevice(bobId, 'a'.repeat(64));
    const sender = useSender();
    await mentionBob();
    outbox.startPushWorker(log);
    outbox.startPushWorker(log); // second call is a no-op, not a second timer
    await new Promise((r) => setTimeout(r, 200));
    outbox._stopPushWorkerForTests();
    expect(sender.sent).toHaveLength(1);
    expect((await pushRows())[0]!.deliveredAt).not.toBeNull();
  });
});

// The two acceptance items from #250 that the issue asks a physical device to
// prove — "a real 410 disables the token" and "a deliberate bad key does not
// consume retries" — are properties of the driver PLUS this worker, so the
// composition is what has to hold. Here the real HTTP/2 driver is wired to a
// fake Apple on a real socket, and the assertions are on the database rows the
// drain leaves behind. A phone is still needed to prove APNs itself agrees
// with our reading of its status codes; nothing above that line is left to it.
describe('the real APNs driver, end to end against a fake Apple', () => {
  let reply = { status: 200, body: '' };
  const server = http2.createServer();
  let origin = '';

  beforeAll(async () => {
    server.on('stream', (stream) => {
      stream.on('data', () => {});
      stream.on('end', () => {
        stream.respond({ ':status': reply.status, 'apns-id': 'FAKE-ID', 'content-type': 'application/json' });
        stream.end(reply.body);
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  afterAll(async () => {
    closeApnsSessions();
    await new Promise<void>((r) => server.close(() => r()));
  });

  const useRealDriver = () => {
    _setPushSenderForTests(
      new ApnsHttp2PushSender({
        origins: { production: origin, sandbox: origin },
        signer: async () => 'test.jwt.sig',
        log: { warn: () => {}, error: () => {} },
      }),
    );
  };

  it('delivers through the driver and marks the row delivered', async () => {
    reply = { status: 200, body: '' };
    await addDevice(bobId, 'b'.repeat(64));
    useRealDriver();
    await mentionBob();
    expect(await outbox.drainPendingPush(log)).toBe(1);
    expect((await pushRows())[0]!.deliveredAt).not.toBeNull();
  });

  it('a bad provider key (403) burns no retries', async () => {
    // The "deliberate bad key" check, minus Apple: one attempt, then failed.
    // Retrying a wrong FLOW_APNS_KEY four times per notification would bury the
    // one log line that names the actual problem.
    reply = { status: 403, body: '{"reason":"InvalidProviderToken"}' };
    await addDevice(bobId, 'b'.repeat(64));
    useRealDriver();
    await mentionBob();
    await outbox.drainPendingPush(log);
    const row = (await pushRows())[0]!;
    expect(row.attempts).toBe(1);
    expect(row.failedAt).not.toBeNull();
    // ...and the device is left alone: nothing is wrong with the phone.
    expect((await db.select().from(deviceTokens).where(eq(deviceTokens.userId, bobId)))[0]!.disabledAt).toBeNull();
  });

  it('a real 410 disables the device row', async () => {
    reply = { status: 410, body: '{"reason":"Unregistered","timestamp":1788000000000}' };
    await addDevice(bobId, 'b'.repeat(64));
    useRealDriver();
    await mentionBob();
    await outbox.drainPendingPush(log);
    expect((await db.select().from(deviceTokens).where(eq(deviceTokens.userId, bobId)))[0]!.disabledAt).not.toBeNull();
  });

  it('backs off on 429 rather than giving up', async () => {
    reply = { status: 429, body: '{"reason":"TooManyRequests"}' };
    await addDevice(bobId, 'b'.repeat(64));
    useRealDriver();
    await mentionBob();
    await outbox.drainPendingPush(log);
    const row = (await pushRows())[0]!;
    expect(row.attempts).toBe(1);
    expect(row.failedAt).toBeNull();
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  });
});
