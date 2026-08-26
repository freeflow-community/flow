// Per-workspace unread totals (#345) — the number the sidebar rail badge
// shows. The badge counts unread NOTIFICATIONS (operator ruling 2026-07-26: a
// rendered count means "this needs you"), mirroring the Activity total — so
// reading the Activity feed drains it, plain unread messages never move it,
// and it stays scoped to one workspace. DB-backed — scratch database on the
// dev postgres (docker compose in packages/infra, host port 5442).
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';

process.env.DATABASE_URL = process.env.FLOW_TEST_DATABASE_URL
  ?? 'postgres://flow:flow_dev@localhost:5442/flow_ws_unread_test';
process.env.FLOW_DATA_KEY = randomBytes(32).toString('base64');

// self-sufficient: create the scratch database if it doesn't exist yet
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
const { and, desc, eq, isNull } = await import('drizzle-orm');

let aliceId = '';
let bobId = '';
let wsA = '';
let wsB = '';
let standup = '';
let other = '';

async function registerHuman(email: string, name: string): Promise<string> {
  const res = await auth.register(email, { password: 'password123', displayName: name, autoVerify: true });
  if (!('token' in res)) throw new Error('expected autoVerify session');
  return res.user.id;
}

/** The badge number for one workspace, straight off `/v1/me/workspaces`. */
async function badge(userId: string, workspaceId: string): Promise<number> {
  const list = await ws.myWorkspaces(userId);
  return list.find((w) => w.id === workspaceId)?.unreadCount ?? -1;
}

/** Bob mentions Alice in `channelId` — one unread notification for her. */
async function bobMentionsAlice(channelId: string): Promise<void> {
  await msg.sendMessage(channelId, bobId, randomUUID(), `hey <@${aliceId}>`, undefined, undefined, [aliceId]);
}

/** Alice's newest unread notification id — the Activity sweep cursor. */
async function newestNotificationId(): Promise<string> {
  const rows = await db
    .select({ id: schema.notifications.id })
    .from(schema.notifications)
    .where(and(eq(schema.notifications.userId, aliceId), isNull(schema.notifications.readAt)))
    .orderBy(desc(schema.notifications.id))
    .limit(1);
  return rows[0]!.id;
}

beforeAll(async () => {
  await migrate(process.env.DATABASE_URL!);
  await db.execute(`TRUNCATE users, workspaces, sessions, invites, pending_signups RESTART IDENTITY CASCADE` as never);
  aliceId = await registerHuman('alice@example.test', 'Alice');
  bobId = await registerHuman('bob@example.test', 'Bob');

  const a = await ws.createWorkspace(aliceId, 'Alpha', `alpha-${randomUUID().slice(0, 8)}`);
  wsA = a.id;
  const b = await ws.createWorkspace(aliceId, 'Beta', `beta-${randomUUID().slice(0, 8)}`);
  wsB = b.id;
  for (const workspaceId of [wsA, wsB]) {
    await db.insert(schema.workspaceMembers).values({ workspaceId, userId: bobId, role: 'member' });
  }
  standup = (await ch.createChannel(wsA, aliceId, 'standup')).id;
  other = (await ch.createChannel(wsB, aliceId, 'other')).id;
  for (const c of [standup, other]) await ch.addMember(c, aliceId, bobId);
});

afterAll(async () => {
  await closeDb();
});

describe('per-workspace unread totals (notification-backed)', () => {
  it('starts at zero for a quiet workspace', async () => {
    expect(await badge(aliceId, wsA)).toBe(0);
    expect(await badge(aliceId, wsB)).toBe(0);
  });

  it('plain unread messages do not move the badge — only notifications do', async () => {
    await msg.sendMessage(standup, bobId, randomUUID(), 'no mention here');
    expect(await badge(aliceId, wsA)).toBe(0);
  });

  it('counts notifications, scoped to their workspace', async () => {
    // Bob's badge already carries his channel-invite notification (kind 5,
    // from being added to #standup) — correct, and it must not move here.
    const bobBefore = await badge(bobId, wsA);
    await bobMentionsAlice(standup);
    await bobMentionsAlice(standup);
    await bobMentionsAlice(other);
    expect(await badge(aliceId, wsA)).toBe(2);
    expect(await badge(aliceId, wsB)).toBe(1);
    // the sender's own badge never moves
    expect(await badge(bobId, wsA)).toBe(bobBefore);
  });

  it('agrees with the sum of the per-channel sidebar numbers', async () => {
    const chans = await ch.listChannels(wsA, aliceId);
    const channelSum = chans.reduce((n, c) => n + c.unreadNotifications, 0);
    expect(await badge(aliceId, wsA)).toBe(channelSum);
  });

  it('a DM message is a notification and counts', async () => {
    const dm = await ch.createDm(wsA, bobId, [aliceId]);
    await msg.sendMessage(dm.id, bobId, randomUUID(), 'psst');
    expect(await badge(aliceId, wsA)).toBe(3);
  });

  it('the Activity sweep drains its own workspace and leaves the other alone', async () => {
    await nt.markNotificationsRead(aliceId, { upToId: await newestNotificationId(), workspaceId: wsA });
    expect(await badge(aliceId, wsA)).toBe(0);
    expect(await badge(aliceId, wsB)).toBe(1);
  });

  it("reading a channel clears that channel's share of the badge", async () => {
    const rows = await db
      .select({ id: schema.messages.id })
      .from(schema.messages)
      .where(eq(schema.messages.channelId, other))
      .orderBy(desc(schema.messages.id))
      .limit(1);
    await ch.markRead(other, aliceId, rows[0]!.id);
    expect(await badge(aliceId, wsB)).toBe(0);
  });
});
