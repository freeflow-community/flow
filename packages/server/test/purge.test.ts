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
const { buildApp } = await import('../src/app.js');
const auth = await import('../src/services/auth.js');
const ws = await import('../src/services/workspaces.js');
const ch = await import('../src/services/channels.js');
const msg = await import('../src/services/messages.js');
const { newId } = await import('../src/lib/ids.js');
const { eq, inArray } = await import('drizzle-orm');

const { files, messageFiles, messagePins, messages, notifications, reactions, users, workspaceMembers } = schema;

let userId = '';
let adminId = '';
let memberId = '';
let adminToken = '';
let memberToken = '';
let workspaceId = '';
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
  workspaceId = wsDto.id;
  const chan = await ch.createChannel(wsDto.id, userId, `chan-${Date.now()}`);
  channelId = chan.id;
  const admin = await auth.register('admin@example.test', {
    password: 'password123',
    displayName: 'Admin',
    autoVerify: true,
  });
  const member = await auth.register('member@example.test', {
    password: 'password123',
    displayName: 'Member',
    autoVerify: true,
  });
  if (!('token' in admin) || !('token' in member)) throw new Error('expected autoVerify sessions');
  adminId = admin.user.id;
  memberId = member.user.id;
  adminToken = admin.token;
  memberToken = member.token;
  await db.insert(workspaceMembers).values([
    { workspaceId: wsDto.id, userId: adminId, role: 'admin' },
    { workspaceId: wsDto.id, userId: memberId, role: 'member' },
  ]);
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

  it('does not let an ordinary member permanently delete another author', async () => {
    const m = await msg.sendMessage(channelId, userId, nextCmid(), 'mine');
    await expect(msg.deleteMessage(m.id, memberId, { hard: true })).rejects.toThrow();
    // still present
    const rows = await db.select().from(messages).where(eq(messages.id, m.id));
    expect(rows.length).toBe(1);
  });

  it('does not let an ordinary member permanently delete their own message', async () => {
    const m = await msg.sendMessage(channelId, memberId, nextCmid(), 'soft-delete only');
    await expect(msg.deleteMessage(m.id, memberId, { hard: true })).rejects.toThrow();
    expect(await db.select().from(messages).where(eq(messages.id, m.id))).toHaveLength(1);
  });

  it('lets a trusted internal agent cleanup purge its own ephemeral status row', async () => {
    const m = await msg.sendMessage(channelId, memberId, nextCmid(), '🤖 *thinking…*');
    await msg.deleteMessage(m.id, memberId, { hard: true, allowOwnPermanentDelete: true });
    expect(await db.select().from(messages).where(eq(messages.id, m.id))).toHaveLength(0);
  });

  it('lets a session-authenticated agent purge its own status row through the HTTP route', async () => {
    await db.update(users).set({ isAgent: true }).where(eq(users.id, memberId));
    const m = await msg.sendMessage(channelId, memberId, nextCmid(), '🤖 *thinking…*');
    const app = buildApp();
    try {
      const removed = await app.inject({
        method: 'DELETE',
        url: `/v1/messages/${m.id}?purge=true`,
        headers: { authorization: `Bearer ${memberToken}` },
      });
      expect(removed.statusCode).toBe(200);
      expect(await db.select().from(messages).where(eq(messages.id, m.id))).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it.each(['owner', 'admin'] as const)('%s can permanently delete another member’s message', async (role) => {
    const m = await msg.sendMessage(channelId, memberId, nextCmid(), 'moderate me');
    await msg.deleteMessage(m.id, role === 'owner' ? userId : adminId, { hard: true });
    expect(await db.select().from(messages).where(eq(messages.id, m.id))).toHaveLength(0);
  });

  it('requires the explicit purge mode when an admin deletes another author', async () => {
    const m = await msg.sendMessage(channelId, memberId, nextCmid(), 'not a soft moderation action');
    await expect(msg.deleteMessage(m.id, adminId)).rejects.toThrow();
    expect(await db.select().from(messages).where(eq(messages.id, m.id))).toHaveLength(1);
  });

  it('lets an admin remove an existing soft-delete tombstone', async () => {
    const m = await msg.sendMessage(channelId, memberId, nextCmid(), 'first soft, then gone');
    await msg.deleteMessage(m.id, memberId);
    let rows = await db.select().from(messages).where(eq(messages.id, m.id));
    expect(rows[0]!.deletedAt).not.toBeNull();

    await msg.deleteMessage(m.id, adminId, { hard: true });
    rows = await db.select().from(messages).where(eq(messages.id, m.id));
    expect(rows).toHaveLength(0);
  });

  it('does not let an owner or admin purge a system courtesy line', async () => {
    await ch.joinChannel(channelId, adminId);
    const [system] = await db
      .select()
      .from(messages)
      .where(eq(messages.systemKind, 'member_joined'));
    expect(system).toBeTruthy();

    for (const actorId of [userId, adminId]) {
      await expect(msg.deleteMessage(system!.id, actorId, { hard: true })).rejects.toThrow();
    }
    expect(await db.select().from(messages).where(eq(messages.id, system!.id))).toHaveLength(1);
  });

  it('enforces moderation and purge mode through the authenticated HTTP route', async () => {
    const m = await msg.sendMessage(channelId, userId, nextCmid(), 'remove through the real API');
    const memberOwn = await msg.sendMessage(channelId, memberId, nextCmid(), 'ordinary soft-delete only');
    const app = buildApp();
    try {
      const ownDenied = await app.inject({
        method: 'DELETE',
        url: `/v1/messages/${memberOwn.id}?purge=true`,
        headers: { authorization: `Bearer ${memberToken}` },
      });
      expect(ownDenied.statusCode).toBe(403);
      expect(await db.select().from(messages).where(eq(messages.id, memberOwn.id))).toHaveLength(1);

      const denied = await app.inject({
        method: 'DELETE',
        url: `/v1/messages/${m.id}?purge=true`,
        headers: { authorization: `Bearer ${memberToken}` },
      });
      expect(denied.statusCode).toBe(403);
      expect(await db.select().from(messages).where(eq(messages.id, m.id))).toHaveLength(1);

      const removed = await app.inject({
        method: 'DELETE',
        url: `/v1/messages/${m.id}?purge=true`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(removed.statusCode).toBe(200);
      expect(removed.json()).toEqual({ ok: true });
      expect(await db.select().from(messages).where(eq(messages.id, m.id))).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it('reaps an attachment after its last message reference is purged', async () => {
    const fileId = newId();
    await db.insert(files).values({
      id: fileId,
      workspaceId,
      userId: memberId,
      name: 'temporary.txt',
      mimeType: 'text/plain',
      sizeBytes: 4,
      storageKey: `test/${fileId}`,
    });
    const m = await msg.sendMessage(channelId, memberId, nextCmid(), 'attached', undefined, [fileId]);

    await msg.deleteMessage(m.id, adminId, { hard: true });

    expect(await db.select().from(messageFiles).where(eq(messageFiles.messageId, m.id))).toHaveLength(0);
    expect(await db.select().from(files).where(eq(files.id, fileId))).toHaveLength(0);
  });

  it('keeps an attachment that another message still references', async () => {
    const fileId = newId();
    await db.insert(files).values({
      id: fileId,
      workspaceId,
      userId: memberId,
      name: 'shared.txt',
      mimeType: 'text/plain',
      sizeBytes: 6,
      storageKey: `test/${fileId}`,
    });
    const first = await msg.sendMessage(channelId, memberId, nextCmid(), 'first', undefined, [fileId]);
    const survivor = await msg.sendMessage(channelId, memberId, nextCmid(), 'second', undefined, [fileId]);

    await msg.deleteMessage(first.id, adminId, { hard: true });

    expect(await db.select().from(files).where(eq(files.id, fileId))).toHaveLength(1);
    expect(await db.select().from(messageFiles).where(eq(messageFiles.messageId, survivor.id))).toHaveLength(1);
  });

  it('permanently deleting a root removes the complete thread', async () => {
    const root = await msg.sendMessage(channelId, memberId, nextCmid(), 'bad bot root');
    const one = await msg.sendMessage(channelId, userId, nextCmid(), 'first reply', root.id);
    const two = await msg.sendMessage(channelId, adminId, nextCmid(), 'second reply', root.id);
    await db.insert(reactions).values({ messageId: one.id, userId: memberId, emoji: '👍' });
    await db.insert(messagePins).values({ messageId: root.id, channelId, pinnedBy: adminId });
    await db.insert(notifications).values({
      id: newId(),
      userId: memberId,
      messageId: two.id,
      channelId,
      kind: 2,
      actorId: adminId,
    });

    await msg.deleteMessage(root.id, adminId, { hard: true });

    const targetIds = [root.id, one.id, two.id];
    const rows = await db
      .select()
      .from(messages)
      .where(inArray(messages.id, targetIds));
    expect(rows).toHaveLength(0);
    expect(await db.select().from(reactions).where(inArray(reactions.messageId, targetIds))).toHaveLength(0);
    expect(await db.select().from(notifications).where(inArray(notifications.messageId, targetIds))).toHaveLength(0);
    expect(await db.select().from(messagePins).where(inArray(messagePins.messageId, targetIds))).toHaveLength(0);
  });
});
