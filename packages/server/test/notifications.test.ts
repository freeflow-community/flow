// Notifications (phase 10): mention subkind (direct/here/channel), the
// server-side suppressAlert gate (per-user prefs + status suppression), and
// patchMe pref merge semantics. DB-backed — scratch database on the dev
// postgres (docker compose in packages/infra, host port 5442).
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';

process.env.DATABASE_URL = process.env.FLOW_TEST_DATABASE_URL
  ?? 'postgres://flow:flow_dev@localhost:5442/flow_notifications_test';
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
const nt = await import('../src/services/notifications.js');
const us = await import('../src/services/users.js');
const { online } = await import('../src/presence.js');
const { and, desc, eq } = await import('drizzle-orm');

const { channelMembers, notifications, users } = schema;

let aliceId = '';
let bobId = '';
let carolId = '';
let workspaceId = '';
let channelId = ''; // standard channel: alice, bob, carol
let dmChannelId = ''; // alice ↔ bob DM

async function registerHuman(email: string, name: string): Promise<string> {
  const res = await auth.register(email, { password: 'password123', displayName: name, autoVerify: true });
  if (!('token' in res)) throw new Error('expected autoVerify session');
  return res.user.id;
}

/** Newest notification row for a user (optionally for one message). */
async function latestNotification(userId: string, messageId?: string) {
  const conds = [eq(notifications.userId, userId)];
  if (messageId) conds.push(eq(notifications.messageId, messageId));
  return (
    await db.select().from(notifications).where(and(...conds)).orderBy(desc(notifications.id)).limit(1)
  )[0];
}

/** suppressAlert for a user's notification row, as the REST list computes it. */
async function listedSuppress(userId: string, messageId: string): Promise<boolean | undefined> {
  const page = await nt.listNotifications(userId, undefined, 50);
  return page.notifications.find((n) => n.messageId === messageId)?.suppressAlert;
}

beforeAll(async () => {
  await migrate(process.env.DATABASE_URL!);
  await db.execute(`TRUNCATE users, workspaces, sessions, invites, pending_signups RESTART IDENTITY CASCADE` as never);
  aliceId = await registerHuman('alice@example.test', 'Alice');
  bobId = await registerHuman('bob@example.test', 'Bob');
  carolId = await registerHuman('carol@example.test', 'Carol');

  const w = await ws.createWorkspace(aliceId, 'Notifications Test', `notifications-${randomUUID().slice(0, 8)}`);
  workspaceId = w.id;
  for (const uid of [bobId, carolId]) {
    await db.insert(schema.workspaceMembers).values({ workspaceId, userId: uid, role: 'member' });
  }
  const chan = await ch.createChannel(workspaceId, aliceId, 'alerts');
  channelId = chan.id;
  await ch.addMember(channelId, aliceId, bobId);
  await ch.addMember(channelId, aliceId, carolId);
  const dm = await ch.createDm(workspaceId, aliceId, [bobId]);
  dmChannelId = dm.id;
});

afterAll(async () => {
  online.delete(carolId);
  await closeDb();
});

describe('mention subkind', () => {
  it('records direct mentions as mention', async () => {
    const m = await msg.sendMessage(channelId, aliceId, randomUUID(), `hi <@${bobId}>`, undefined, undefined, [bobId]);
    const n = await latestNotification(bobId, m.id);
    expect(n?.kind).toBe(0);
    expect(n?.subkind).toBe('mention');
  });

  it('records <!channel> as channel for every member', async () => {
    const m = await msg.sendMessage(channelId, aliceId, randomUUID(), '<!channel> all hands', undefined, undefined, undefined);
    expect((await latestNotification(bobId, m.id))?.subkind).toBe('channel');
    expect((await latestNotification(carolId, m.id))?.subkind).toBe('channel');
  });

  it('records <!here> as here, online members only', async () => {
    online.set(carolId, 1);
    try {
      const m = await msg.sendMessage(channelId, aliceId, randomUUID(), '<!here> anyone around?', undefined, undefined, undefined);
      expect((await latestNotification(carolId, m.id))?.subkind).toBe('here');
      expect(await latestNotification(bobId, m.id)).toBeUndefined(); // offline: no row
    } finally {
      online.delete(carolId);
    }
  });

  it('a direct mention in the same message beats a group mention', async () => {
    const m = await msg.sendMessage(channelId, aliceId, randomUUID(), `<@${bobId}> <!channel> both`, undefined, undefined, [bobId]);
    expect((await latestNotification(bobId, m.id))?.subkind).toBe('mention');
  });
});

describe('suppressAlertFor', () => {
  const noPrefs = { prefs: {}, statusSuppressAlerts: false };

  it('never alerts channel activity (kind 3)', () => {
    expect(nt.suppressAlertFor(3, null, noPrefs)).toBe(true);
  });

  it('maps kinds and subkinds to their pref keys', () => {
    expect(nt.suppressAlertFor(1, null, { prefs: { dm: false }, statusSuppressAlerts: false })).toBe(true);
    expect(nt.suppressAlertFor(0, 'mention', { prefs: { mention: false }, statusSuppressAlerts: false })).toBe(true);
    expect(nt.suppressAlertFor(0, 'here', { prefs: { groupMention: false }, statusSuppressAlerts: false })).toBe(true);
    expect(nt.suppressAlertFor(0, 'channel', { prefs: { groupMention: false }, statusSuppressAlerts: false })).toBe(true);
    expect(nt.suppressAlertFor(2, null, { prefs: { threadReply: false }, statusSuppressAlerts: false })).toBe(true);
  });

  it('treats legacy null subkind as a direct mention', () => {
    expect(nt.suppressAlertFor(0, null, { prefs: { mention: false }, statusSuppressAlerts: false })).toBe(true);
    expect(nt.suppressAlertFor(0, null, { prefs: { groupMention: false }, statusSuppressAlerts: false })).toBe(false);
  });

  it('a suppressing status wins over every pref', () => {
    expect(nt.suppressAlertFor(1, null, { prefs: {}, statusSuppressAlerts: true })).toBe(true);
    expect(nt.suppressAlertFor(0, 'mention', { prefs: {}, statusSuppressAlerts: true })).toBe(true);
  });

  it('defaults to alerting when no pref is set', () => {
    expect(nt.suppressAlertFor(1, null, noPrefs)).toBe(false);
    expect(nt.suppressAlertFor(0, 'mention', noPrefs)).toBe(false);
    expect(nt.suppressAlertFor(2, null, noPrefs)).toBe(false);
  });
});

describe('suppressAlert at list time (phase 10 gate)', () => {
  it('defaults to false and follows the matching pref toggle', async () => {
    const m = await msg.sendMessage(channelId, aliceId, randomUUID(), `<@${bobId}> gate test`, undefined, undefined, [bobId]);
    expect(await listedSuppress(bobId, m.id)).toBe(false);

    await us.patchMe(bobId, { notificationPrefs: { mention: false } });
    expect(await listedSuppress(bobId, m.id)).toBe(true);

    // unrelated kinds are unaffected by the mention toggle
    const dm = await msg.sendMessage(dmChannelId, aliceId, randomUUID(), 'dm gate', undefined, undefined, undefined);
    expect(await listedSuppress(bobId, dm.id)).toBe(false);
  });

  it('patchMe merges prefs shallowly (one toggle never clobbers another)', async () => {
    await us.patchMe(bobId, { notificationPrefs: { mention: false } });
    await us.patchMe(bobId, { notificationPrefs: { dm: false } });
    const me = await db.select({ prefs: users.notificationPrefs }).from(users).where(eq(users.id, bobId)).limit(1);
    expect(me[0]?.prefs).toMatchObject({ mention: false, dm: false });
  });

  it('status suppression silences everything until cleared', async () => {
    await us.patchMe(bobId, { notificationPrefs: { mention: true, dm: true } }); // back to defaults
    await us.patchMe(bobId, { statusSuppressAlerts: true });
    const m = await msg.sendMessage(channelId, aliceId, randomUUID(), `<@${bobId}> dnd test`, undefined, undefined, [bobId]);
    expect(await listedSuppress(bobId, m.id)).toBe(true);

    await us.patchMe(bobId, { statusSuppressAlerts: false });
    expect(await listedSuppress(bobId, m.id)).toBe(false);
  });

  it('kind-3 channel activity rows are always suppressed', async () => {
    await db.update(channelMembers).set({ notifyLevel: 2 }).where(
      and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, carolId)),
    );
    const m = await msg.sendMessage(channelId, aliceId, randomUUID(), 'plain traffic', undefined, undefined, undefined);
    const n = await latestNotification(carolId, m.id);
    expect(n?.kind).toBe(3);
    expect(await listedSuppress(carolId, m.id)).toBe(true);
  });
});
