// Hard delete / purge (message.purged): the agent-bridge's ephemeral "thinking…"
// status message must vanish on completion, not linger as a "This message was
// deleted" tombstone above the real reply. `deleteMessage(..., { hard: true })`
// removes the row outright and fixes the root's denormalized thread rollup.
// DB-backed — runs against a scratch database on the dev postgres (docker
// compose in packages/infra, host port 5442). NATS is not required
// (publishEvent no-ops without a bus).
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';

process.env.DATABASE_URL = process.env.FLOW_TEST_DATABASE_URL
  ?? 'postgres://flow:flow_dev@localhost:5442/flow_purge_test';
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
const { eq } = await import('drizzle-orm');

const { messages } = schema;

let userId = '';
let channelId = '';
let cmid = 0;
const nextCmid = (): string =>
  `00000000-0000-4000-8000-${String(++cmid).padStart(12, '0')}`;

beforeAll(async () => {
  await migrate(process.env.DATABASE_URL!);
});

beforeEach(async () => {
  await db.execute(`TRUNCATE users, workspaces, channels, messages RESTART IDENTITY CASCADE` as never);
  const res = await auth.register('owner@example.test', {
    password: 'password123',
    displayName: 'Owner',
    autoVerify: true,
  });
  if (!('token' in res)) throw new Error('expected autoVerify session');
  userId = res.user.id;
  const wsDto = await ws.createWorkspace(userId, 'WS', `ws-${Date.now()}`);
  const chan = await ch.createChannel(wsDto.id, userId, `chan-${Date.now()}`);
  channelId = chan.id;
});

afterAll(async () => {
  await closeDb();
});

describe('hard delete / purge', () => {
  it('removes the row entirely (no tombstone) — unlike a soft delete', async () => {
    const soft = await msg.sendMessage(channelId, userId, nextCmid(), 'soft one');
    const hard = await msg.sendMessage(channelId, userId, nextCmid(), 'hard one');

    await msg.deleteMessage(soft.id, userId); // default = soft
    await msg.deleteMessage(hard.id, userId, { hard: true });

    const [softRow] = await db.select().from(messages).where(eq(messages.id, soft.id));
    expect(softRow).toBeTruthy(); // kept, renders as a tombstone
    expect(softRow!.deletedAt).not.toBeNull();

    const hardRows = await db.select().from(messages).where(eq(messages.id, hard.id));
    expect(hardRows.length).toBe(0); // gone — no tombstone
  });

  it('is idempotent: purging an already-gone message does not throw', async () => {
    const m = await msg.sendMessage(channelId, userId, nextCmid(), 'ephemeral');
    await msg.deleteMessage(m.id, userId, { hard: true });
    await expect(msg.deleteMessage(m.id, userId, { hard: true })).resolves.toBeUndefined();
  });

  it('decrements the root rollup and recomputes lastReplyAt when a reply is purged', async () => {
    const root = await msg.sendMessage(channelId, userId, nextCmid(), 'root');
    const first = await msg.sendMessage(channelId, userId, nextCmid(), 'first reply', root.id);
    const status = await msg.sendMessage(channelId, userId, nextCmid(), '🤖 thinking…', root.id);

    // both replies counted on the root
    let [rootRow] = await db.select().from(messages).where(eq(messages.id, root.id));
    expect(rootRow!.replyCount).toBe(2);
    expect(rootRow!.lastReplyAt?.toISOString()).toBe(status.createdAt);

    // purge the ephemeral status reply
    await msg.deleteMessage(status.id, userId, { hard: true });

    [rootRow] = await db.select().from(messages).where(eq(messages.id, root.id));
    expect(rootRow!.replyCount).toBe(1); // back down
    expect(rootRow!.lastReplyAt?.toISOString()).toBe(first.createdAt); // recomputed to the survivor
  });

  it('enforces author-only, same as soft delete', async () => {
    const other = await auth.register('intruder@example.test', {
      password: 'password123',
      displayName: 'Intruder',
      autoVerify: true,
    });
    if (!('token' in other)) throw new Error('expected autoVerify session');
    const m = await msg.sendMessage(channelId, userId, nextCmid(), 'mine');
    await expect(msg.deleteMessage(m.id, other.user.id, { hard: true })).rejects.toThrow();
    // still present
    const rows = await db.select().from(messages).where(eq(messages.id, m.id));
    expect(rows.length).toBe(1);
  });
});
