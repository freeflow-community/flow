// Per-workspace unread totals (#345) — the number the sidebar rail badge
// shows. The total must obey the same rules the per-channel count does, and it
// must stay scoped to one workspace: activity in workspace B never touches A's
// badge. DB-backed — scratch database on the dev postgres (docker compose in
// packages/infra, host port 5442).
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';

process.env.DATABASE_URL = process.env.FLOW_TEST_DATABASE_URL
  ?? 'postgres://flow:flow_dev@localhost:5442/flow_ws_unread_test';
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
const { desc, eq } = await import('drizzle-orm');

let aliceId = '';
let bobId = '';
let wsA = ''; // alice + bob, two channels
let wsB = ''; // alice + bob, one channel
let standup = ''; // in wsA
let random = ''; // in wsA
let other = ''; // in wsB

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

/** Bob posts `n` messages into a channel; returns the last message's id. */
async function bobPosts(channelId: string, n: number): Promise<string> {
  let last = '';
  for (let i = 0; i < n; i++) {
    const m = await msg.sendMessage(channelId, bobId, randomUUID(), `msg ${i}`);
    last = m.id;
  }
  return last;
}

/** Newest top-level message in a channel — what a client would read up to. */
async function newestMessageId(channelId: string): Promise<string> {
  const rows = await db
    .select({ id: schema.messages.id })
    .from(schema.messages)
    .where(eq(schema.messages.channelId, channelId))
    .orderBy(desc(schema.messages.id))
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
  random = (await ch.createChannel(wsA, aliceId, 'random')).id;
  other = (await ch.createChannel(wsB, aliceId, 'other')).id;
  for (const c of [standup, random, other]) await ch.addMember(c, aliceId, bobId);
});

afterAll(async () => {
  await closeDb();
});

describe('per-workspace unread totals', () => {
  it('starts at zero for a quiet workspace', async () => {
    expect(await badge(aliceId, wsA)).toBe(0);
    expect(await badge(aliceId, wsB)).toBe(0);
  });

  it('sums across the channels I am in, and stays inside its workspace', async () => {
    await bobPosts(standup, 2);
    await bobPosts(random, 3);
    expect(await badge(aliceId, wsA)).toBe(5);
    expect(await badge(aliceId, wsB)).toBe(0);

    // A message in the other workspace moves only that workspace's badge.
    await bobPosts(other, 1);
    expect(await badge(aliceId, wsA)).toBe(5);
    expect(await badge(aliceId, wsB)).toBe(1);
  });

  it('does not count my own messages', async () => {
    const before = await badge(bobId, wsA);
    await msg.sendMessage(standup, bobId, randomUUID(), 'mine');
    expect(await badge(bobId, wsA)).toBe(before);
  });

  it('drops as channels are read', async () => {
    await ch.markRead(standup, aliceId, await newestMessageId(standup));
    expect(await badge(aliceId, wsA)).toBe(3); // #random's three are still unread
  });

  it('ignores muted channels', async () => {
    await ch.setNotifyLevel(random, aliceId, 0);
    expect(await badge(aliceId, wsA)).toBe(0);
    await ch.setNotifyLevel(random, aliceId, 1);
    expect(await badge(aliceId, wsA)).toBe(3);
  });

  it('ignores thread replies, system lines and archived channels', async () => {
    const root = await msg.sendMessage(random, bobId, randomUUID(), 'root');
    const rootUnread = await badge(aliceId, wsA);
    await msg.sendMessage(random, bobId, randomUUID(), 'reply', root.id);
    expect(await badge(aliceId, wsA)).toBe(rootUnread); // the reply is not a top-level message

    await ch.archiveChannel(random, aliceId);
    expect(await badge(aliceId, wsA)).toBe(0);
  });

  it('counts a channel never read at all, cursor or no cursor', async () => {
    const fresh = await ch.createChannel(wsB, aliceId, 'fresh');
    await ch.addMember(fresh.id, aliceId, bobId);
    await bobPosts(fresh.id, 2);
    expect(await badge(aliceId, wsB)).toBe(3); // 1 in #other + 2 here
  });
});
