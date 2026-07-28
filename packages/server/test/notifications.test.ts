// Notifications (phase 10): mention subkind (direct/here/channel), the
// server-side suppressAlert gate (per-user prefs + status suppression), and
// patchMe pref merge semantics. Issue #63 adds reaction notifications (kind 4),
// the personal-DM silence rule, and the implicit read paths (visiting the
// channel or thread a notification came from). DB-backed — scratch database on
// the dev postgres (docker compose in packages/infra, host port 5442).
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
const rx = await import('../src/services/reactions.js');
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

/** The row a message raised for a user (there is at most one per pair). */
async function notificationFor(userId: string, messageId: string) {
  return (
    await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.messageId, messageId)))
      .limit(1)
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

  it('reaction rows follow the reaction pref', async () => {
    expect(nt.suppressAlertFor(4, null, { prefs: {}, statusSuppressAlerts: false })).toBe(false);
    expect(nt.suppressAlertFor(4, null, { prefs: { reaction: false }, statusSuppressAlerts: false })).toBe(true);
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

// ---- issue #63 ---------------------------------------------------

describe('reaction notifications (kind 4)', () => {
  it('notifies the author, carrying the actor and the emoji', async () => {
    const m = await msg.sendMessage(channelId, aliceId, randomUUID(), 'react to me');
    await rx.addReaction(m.id, bobId, '🎉');
    const n = await latestNotification(aliceId, m.id);
    expect(n?.kind).toBe(4);
    expect(n?.actorId).toBe(bobId);
    expect(n?.reactionEmoji).toBe('🎉');

    const listed = (await nt.listNotifications(aliceId, undefined, 50)).notifications.find((x) => x.id === n?.id);
    expect(listed?.actorId).toBe(bobId);
    expect(listed?.reactionEmoji).toBe('🎉');
    expect(listed?.message.userId).toBe(aliceId); // the row is about MY message
  });

  it('never notifies you about your own reaction', async () => {
    const m = await msg.sendMessage(channelId, aliceId, randomUUID(), 'self react');
    await rx.addReaction(m.id, aliceId, '👍');
    expect(await latestNotification(aliceId, m.id)).toBeUndefined();
  });

  it('re-adding the same reaction never notifies twice', async () => {
    const m = await msg.sendMessage(channelId, aliceId, randomUUID(), 'flip flop');
    await rx.addReaction(m.id, bobId, '👀');
    await rx.removeReaction(m.id, bobId, '👀');
    await rx.addReaction(m.id, bobId, '👀');
    const rows = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, aliceId), eq(notifications.messageId, m.id)));
    expect(rows).toHaveLength(1);
  });

  it('stays silent when the author muted the channel', async () => {
    await ch.setNotifyLevel(channelId, carolId, 0);
    try {
      const m = await msg.sendMessage(channelId, carolId, randomUUID(), 'muted author');
      await rx.addReaction(m.id, bobId, '🔕');
      expect(await latestNotification(carolId, m.id)).toBeUndefined();
    } finally {
      await ch.setNotifyLevel(channelId, carolId, 2); // restore the kind-3 fixture
    }
  });
});

describe('your personal DM never notifies', () => {
  it('writes no rows for a message to yourself', async () => {
    const selfDm = await ch.createDm(workspaceId, aliceId, [aliceId]);
    const m = await msg.sendMessage(selfDm.id, aliceId, randomUUID(), 'note to self');
    const rows = await db.select().from(notifications).where(eq(notifications.messageId, m.id));
    expect(rows).toHaveLength(0);
  });
});

describe('per-channel unread notification count (the sidebar badge)', () => {
  const countFor = async (userId: string, workspaceId: string, channelId: string) =>
    (await ch.listChannels(workspaceId, userId)).find((c) => c.id === channelId)?.unreadNotifications;

  it('counts this channel unread notifications, not its unread messages', async () => {
    const fresh = await ch.createChannel(workspaceId, aliceId, `badge-${randomUUID().slice(0, 8)}`);
    await ch.addMember(fresh.id, aliceId, bobId);
    // three messages, one of which mentions bob → bold-worthy, but badge 1
    await msg.sendMessage(fresh.id, aliceId, randomUUID(), 'chatter one');
    await msg.sendMessage(fresh.id, aliceId, randomUUID(), 'chatter two');
    await msg.sendMessage(fresh.id, aliceId, randomUUID(), `<@${bobId}> look`, undefined, undefined, [bobId]);

    const row = (await ch.listChannels(workspaceId, bobId)).find((c) => c.id === fresh.id);
    expect(row?.unreadCount).toBe(3); // emboldens the row
    expect(row?.unreadNotifications).toBe(1); // the number on screen
  });

  it('drops to zero when the channel is read, and never counts another channel', async () => {
    const fresh = await ch.createChannel(workspaceId, aliceId, `badge-${randomUUID().slice(0, 8)}`);
    await ch.addMember(fresh.id, aliceId, bobId);
    const m = await msg.sendMessage(fresh.id, aliceId, randomUUID(), `<@${bobId}> hi`, undefined, undefined, [bobId]);
    const dmMsg = await msg.sendMessage(dmChannelId, aliceId, randomUUID(), 'unrelated dm');
    expect(await countFor(bobId, workspaceId, fresh.id)).toBe(1);

    await ch.markRead(fresh.id, bobId, m.id);
    expect(await countFor(bobId, workspaceId, fresh.id)).toBe(0);
    // the DM's own badge is untouched by reading a channel
    expect(await countFor(bobId, workspaceId, dmChannelId)).toBeGreaterThan(0);
    expect((await nt.listNotifications(bobId, undefined, 50)).notifications.find((n) => n.messageId === dmMsg.id)?.readAt).toBeNull();
  });

  it('sums to the Activity total', async () => {
    const page = await nt.listNotifications(bobId, undefined, 200);
    const perChannel = (await ch.listChannels(workspaceId, bobId)).reduce((n, c) => n + c.unreadNotifications, 0);
    expect(perChannel).toBe(page.unreadCount);
  });
});

describe('losing access retires the unread signal (read, never deleted)', () => {
  it('leaving a channel marks its rows read — threads included', async () => {
    const fresh = await ch.createChannel(workspaceId, aliceId, `leave-${randomUUID().slice(0, 8)}`);
    await ch.addMember(fresh.id, aliceId, bobId);
    const root = await msg.sendMessage(fresh.id, aliceId, randomUUID(), `<@${bobId}> root`, undefined, undefined, [bobId]);
    const reply = await msg.sendMessage(fresh.id, aliceId, randomUUID(), `<@${bobId}> reply`, root.id, undefined, [bobId]);

    await ch.removeMember(fresh.id, bobId, bobId); // self-leave
    expect((await notificationFor(bobId, root.id))?.readAt).not.toBeNull();
    expect((await notificationFor(bobId, reply.id))?.readAt).not.toBeNull(); // no thread to visit either
    // the record survives — rows are read, not deleted
    expect(await notificationFor(bobId, root.id)).toBeDefined();
  });

  it('archiving a channel retires every member unread rows', async () => {
    const fresh = await ch.createChannel(workspaceId, aliceId, `arch-${randomUUID().slice(0, 8)}`);
    await ch.addMember(fresh.id, aliceId, bobId);
    await ch.addMember(fresh.id, aliceId, carolId);
    const m = await msg.sendMessage(fresh.id, aliceId, randomUUID(), '<!channel> last call');

    await ch.archiveChannel(fresh.id, aliceId);
    expect((await notificationFor(bobId, m.id))?.readAt).not.toBeNull();
    expect((await notificationFor(carolId, m.id))?.readAt).not.toBeNull();
  });
});

describe('implicit read: visiting the channel or thread', () => {
  it('reading a channel reads its top-level notifications, not its threads', async () => {
    const root = await msg.sendMessage(channelId, aliceId, randomUUID(), `<@${bobId}> root`, undefined, undefined, [bobId]);
    const reply = await msg.sendMessage(channelId, aliceId, randomUUID(), `<@${bobId}> reply`, root.id, undefined, [bobId]);

    await ch.markRead(channelId, bobId, root.id);
    expect((await notificationFor(bobId, root.id))?.readAt).not.toBeNull();
    expect((await notificationFor(bobId, reply.id))?.readAt).toBeNull(); // still behind a click

    await ch.markRead(channelId, bobId, root.id, root.id); // opened the thread
    expect((await notificationFor(bobId, reply.id))?.readAt).not.toBeNull();
  });

  it('leaves notifications newer than the read cursor unread', async () => {
    const seen = await msg.sendMessage(channelId, aliceId, randomUUID(), `<@${carolId}> seen`, undefined, undefined, [carolId]);
    const unseen = await msg.sendMessage(channelId, aliceId, randomUUID(), `<@${carolId}> unseen`, undefined, undefined, [carolId]);
    await ch.markRead(channelId, carolId, seen.id);
    expect((await notificationFor(carolId, seen.id))?.readAt).not.toBeNull();
    expect((await notificationFor(carolId, unseen.id))?.readAt).toBeNull();
  });

  it('reading one channel never touches another channel rows', async () => {
    const dmMsg = await msg.sendMessage(dmChannelId, aliceId, randomUUID(), 'unread dm');
    const chanMsg = await msg.sendMessage(channelId, aliceId, randomUUID(), `<@${bobId}> chan`, undefined, undefined, [bobId]);
    await ch.markRead(channelId, bobId, chanMsg.id);
    expect((await notificationFor(bobId, dmMsg.id))?.readAt).toBeNull();
  });

  it('marks a single row read by id (one Activity click)', async () => {
    const older = await msg.sendMessage(dmChannelId, aliceId, randomUUID(), 'older dm');
    const newer = await msg.sendMessage(dmChannelId, aliceId, randomUUID(), 'newer dm');
    const target = await notificationFor(bobId, newer.id);
    await nt.markNotificationsRead(bobId, { id: target!.id });
    expect((await notificationFor(bobId, newer.id))?.readAt).not.toBeNull();
    expect((await notificationFor(bobId, older.id))?.readAt).toBeNull();
  });
});

// Activity is a row inside a workspace's sidebar, so the feed behind it must
// only ever show that workspace's rows — and its cursor sweep must not reach
// across into a workspace the user wasn't looking at.
describe('workspace scoping', () => {
  let otherWorkspaceId = '';
  let otherChannelId = '';

  beforeAll(async () => {
    const w = await ws.createWorkspace(aliceId, 'Other Space', `other-${randomUUID().slice(0, 8)}`);
    otherWorkspaceId = w.id;
    await db.insert(schema.workspaceMembers).values({ workspaceId: otherWorkspaceId, userId: bobId, role: 'member' });
    const chan = await ch.createChannel(otherWorkspaceId, aliceId, 'elsewhere');
    otherChannelId = chan.id;
    await ch.addMember(otherChannelId, aliceId, bobId);
  });

  it('lists only the requested workspace rows', async () => {
    const here = await msg.sendMessage(channelId, aliceId, randomUUID(), `<@${bobId}> here`, undefined, undefined, [bobId]);
    const there = await msg.sendMessage(otherChannelId, aliceId, randomUUID(), `<@${bobId}> there`, undefined, undefined, [bobId]);

    const scoped = await nt.listNotifications(bobId, undefined, 200, workspaceId);
    const ids = scoped.notifications.map((n) => n.messageId);
    expect(ids).toContain(here.id);
    expect(ids).not.toContain(there.id);
    expect(scoped.notifications.every((n) => n.workspaceId === workspaceId)).toBe(true);

    // No workspaceId = the old cross-workspace feed, for clients built before
    // the scoping.
    const global = await nt.listNotifications(bobId, undefined, 200);
    expect(global.notifications.map((n) => n.messageId)).toEqual(expect.arrayContaining([here.id, there.id]));
  });

  it('counts unread per workspace, and the total across all of them', async () => {
    const scoped = await nt.listNotifications(bobId, undefined, 1, otherWorkspaceId);
    const global = await nt.listNotifications(bobId, undefined, 1);
    expect(scoped.unreadCount).toBeGreaterThan(0);
    expect(scoped.totalUnreadCount).toBe(global.unreadCount);
    expect(scoped.totalUnreadCount).toBeGreaterThan(scoped.unreadCount);
    // Unscoped: the two counts are the same number.
    expect(global.totalUnreadCount).toBe(global.unreadCount);
  });

  it('a scoped cursor sweep leaves other workspaces unread', async () => {
    const here = await msg.sendMessage(channelId, aliceId, randomUUID(), `<@${bobId}> sweep here`, undefined, undefined, [bobId]);
    const there = await msg.sendMessage(otherChannelId, aliceId, randomUUID(), `<@${bobId}> sweep there`, undefined, undefined, [bobId]);
    const newest = await latestNotification(bobId);

    // Opening Activity in the first workspace: cursor covers both rows by id,
    // but only this workspace's may flip.
    await nt.markNotificationsRead(bobId, { upToId: newest!.id, workspaceId });
    expect((await notificationFor(bobId, here.id))?.readAt).not.toBeNull();
    expect((await notificationFor(bobId, there.id))?.readAt).toBeNull();

    await nt.markNotificationsRead(bobId, { upToId: newest!.id, workspaceId: otherWorkspaceId });
    expect((await notificationFor(bobId, there.id))?.readAt).not.toBeNull();
  });
});
