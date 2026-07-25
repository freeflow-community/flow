// Per-channel unread counts (#71): your own messages must never badge, and
// posting advances your read cursor. DB-backed — scratch database on the dev
// postgres (docker compose in packages/infra, host port 5442).
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';

process.env.DATABASE_URL = process.env.FLOW_TEST_DATABASE_URL
  ?? 'postgres://flow:flow_dev@localhost:5442/flow_unread_test';
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
const { and, eq } = await import('drizzle-orm');

const { channelMembers } = schema;

let aliceId = '';
let bobId = '';
let workspaceId = '';
let channelId = ''; // standard channel: alice, bob
let dmChannelId = ''; // alice ↔ bob DM

async function registerHuman(email: string, name: string): Promise<string> {
  const res = await auth.register(email, { password: 'password123', displayName: name, autoVerify: true });
  if (!('token' in res)) throw new Error('expected autoVerify session');
  return res.user.id;
}

async function unreadFor(userId: string, chanId: string): Promise<number> {
  const list = await ch.listChannels(workspaceId, userId);
  return list.find((c) => c.id === chanId)?.unreadCount ?? -1;
}

async function readCursor(userId: string, chanId: string): Promise<string | null> {
  const rows = await db
    .select({ lastReadMsgId: channelMembers.lastReadMsgId })
    .from(channelMembers)
    .where(and(eq(channelMembers.channelId, chanId), eq(channelMembers.userId, userId)))
    .limit(1);
  return rows[0]?.lastReadMsgId ?? null;
}

beforeAll(async () => {
  await migrate(process.env.DATABASE_URL!);
  await db.execute(`TRUNCATE users, workspaces, sessions, invites, pending_signups RESTART IDENTITY CASCADE` as never);
  aliceId = await registerHuman('alice@example.test', 'Alice');
  bobId = await registerHuman('bob@example.test', 'Bob');

  const w = await ws.createWorkspace(aliceId, 'Unread Test', `unread-${randomUUID().slice(0, 8)}`);
  workspaceId = w.id;
  await db.insert(schema.workspaceMembers).values({ workspaceId, userId: bobId, role: 'member' });
  const chan = await ch.createChannel(workspaceId, aliceId, 'standup');
  channelId = chan.id;
  await ch.addMember(channelId, aliceId, bobId);
  const dm = await ch.createDm(workspaceId, aliceId, [bobId]);
  dmChannelId = dm.id;
});

afterAll(async () => {
  await closeDb();
});

describe('unread counts ignore your own messages', () => {
  it('a DM message you sent does not badge for you', async () => {
    await msg.sendMessage(dmChannelId, aliceId, randomUUID(), 'note to bob');
    expect(await unreadFor(aliceId, dmChannelId)).toBe(0);
  });

  it("the other party's DM message still badges", async () => {
    await msg.sendMessage(dmChannelId, bobId, randomUUID(), 'hey alice');
    expect(await unreadFor(aliceId, dmChannelId)).toBe(1);
    expect(await unreadFor(bobId, dmChannelId)).toBe(0);
  });

  it('own messages do not badge in a standard channel either', async () => {
    await msg.sendMessage(channelId, aliceId, randomUUID(), 'standup thread starts here');
    await msg.sendMessage(channelId, aliceId, randomUUID(), 'second one');
    expect(await unreadFor(aliceId, channelId)).toBe(0);
    expect(await unreadFor(bobId, channelId)).toBe(2);
  });

  it('a stale read cursor does not resurrect your own messages', async () => {
    // Simulate a client that never advanced the cursor: rewind it to null and
    // confirm only the other party's messages are counted.
    await db
      .update(channelMembers)
      .set({ lastReadMsgId: null })
      .where(and(eq(channelMembers.channelId, dmChannelId), eq(channelMembers.userId, aliceId)));
    expect(await unreadFor(aliceId, dmChannelId)).toBe(1); // bob's message only
  });
});

describe('sending advances the read cursor', () => {
  it('a top-level send moves lastReadMsgId to that message', async () => {
    const m = await msg.sendMessage(channelId, bobId, randomUUID(), 'bob checking in');
    expect(await readCursor(bobId, channelId)).toBe(m.id);
    expect(await unreadFor(bobId, channelId)).toBe(0);
  });

  it('a thread reply leaves the channel cursor alone', async () => {
    const newer = await msg.sendMessage(channelId, bobId, randomUUID(), 'newest');
    await db
      .update(channelMembers)
      .set({ lastReadMsgId: newer.id })
      .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, aliceId)));
    // alice replies in a thread — a reply must not touch the channel cursor
    await msg.sendMessage(channelId, aliceId, randomUUID(), 'threaded reply', newer.id);
    expect(await readCursor(aliceId, channelId)).toBe(newer.id);
  });
});
