// Channel browser (#588): `includeArchived` lists archived public channels,
// archived history stays readable by any workspace member, and every mutation
// on an archived channel is still rejected with `channel_archived`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';

process.env.DATABASE_URL = process.env.FLOW_TEST_DATABASE_URL
  ?? 'postgres://flow:flow_dev@localhost:5442/flow_archived_channels_test';
process.env.FLOW_DATA_KEY = randomBytes(32).toString('base64');

{
  const { default: postgres } = await import('postgres');
  const url = new URL(process.env.DATABASE_URL);
  const dbName = url.pathname.slice(1);
  url.pathname = '/postgres';
  const admin = postgres(url.toString(), { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE "${dbName}"`).catch(() => {});
  await admin.end();
}

const { migrate } = await import('../src/db/migrate.js');
const { db, schema, closeDb } = await import('../src/db/index.js');
const auth = await import('../src/services/auth.js');
const ws = await import('../src/services/workspaces.js');
const ch = await import('../src/services/channels.js');
const msg = await import('../src/services/messages.js');
const rx = await import('../src/services/reactions.js');
const files = await import('../src/services/files.js');
const sched = await import('../src/services/scheduledMessages.js');

const { workspaceMembers } = schema;
let ownerId = '';
let outsiderId = '';
let workspaceId = '';
let liveId = '';
let archivedId = '';
let archivedPrivateId = '';
let rootId = '';

async function register(email: string, displayName: string): Promise<string> {
  const result = await auth.register(email, { password: 'password123', displayName, autoVerify: true });
  if (!('token' in result)) throw new Error('expected auto-verified user');
  return result.user.id;
}

const archived = { code: 'channel_archived' };

beforeAll(async () => {
  await migrate(process.env.DATABASE_URL!);
  await db.execute(
    `TRUNCATE users, workspaces, sessions, invites, pending_signups RESTART IDENTITY CASCADE` as never,
  );
  ownerId = await register('arch-owner@example.test', 'Owner');
  outsiderId = await register('arch-outsider@example.test', 'Outsider');
  workspaceId = (await ws.createWorkspace(ownerId, 'Archive WS', `arch-${Date.now()}`)).id;
  await db.insert(workspaceMembers).values([{ workspaceId, userId: outsiderId, role: 'member' }]);

  liveId = (await ch.createChannel(workspaceId, ownerId, 'live-room', 'still going')).id;
  archivedId = (await ch.createChannel(workspaceId, ownerId, 'old-room', 'retired')).id;
  archivedPrivateId = (await ch.createChannel(workspaceId, ownerId, 'old-secret', undefined, true)).id;
  const root = await msg.sendMessage(archivedId, ownerId, randomUUID(), 'history worth keeping');
  rootId = root.id;
  await msg.sendMessage(archivedId, ownerId, randomUUID(), 'a reply', rootId);
  await ch.archiveChannel(archivedId, ownerId);
  await ch.archiveChannel(archivedPrivateId, ownerId);
});

afterAll(async () => {
  await closeDb();
});

describe('listChannels includeArchived', () => {
  it('excludes archived channels by default', async () => {
    const ids = (await ch.listChannels(workspaceId, ownerId)).map((c) => c.id);
    expect(ids).toContain(liveId);
    expect(ids).not.toContain(archivedId);
    expect(ids).not.toContain(archivedPrivateId);
  });

  it('adds archived public channels, never archived private ones', async () => {
    for (const userId of [ownerId, outsiderId]) {
      const list = await ch.listChannels(workspaceId, userId, { includeArchived: true });
      const old = list.find((c) => c.id === archivedId);
      expect(old?.archivedAt).not.toBeNull();
      expect(old?.unreadCount).toBe(0);
      expect(old?.unreadNotifications).toBe(0);
      expect(list.some((c) => c.id === archivedPrivateId)).toBe(false);
      expect(list.find((c) => c.id === liveId)?.archivedAt).toBeNull();
    }
  });

  it('reports member counts for standard channels', async () => {
    const list = await ch.listChannels(workspaceId, outsiderId, { includeArchived: true });
    expect(list.find((c) => c.id === liveId)?.memberCount).toBe(1);
    expect(list.find((c) => c.id === archivedId)?.memberCount).toBe(1);
  });
});

describe('archived channel reads', () => {
  it('lets a workspace member who never joined read history, threads, pins and files', async () => {
    const page = await msg.listMessages(archivedId, outsiderId, undefined, 50);
    expect(page.messages.map((m) => m.body)).toContain('history worth keeping');
    const thread = await msg.listThread(rootId, outsiderId, undefined, 50);
    expect(thread.messages.map((m) => m.body)).toContain('a reply');
    await expect(msg.listPinnedMessages(archivedId, outsiderId)).resolves.toEqual([]);
    await expect(files.listChannelFiles(archivedId, outsiderId, 'newest', undefined, 50)).resolves.toBeDefined();
  });

  it('still hides archived private channels from non-members', async () => {
    await expect(msg.listMessages(archivedPrivateId, outsiderId, undefined, 50)).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe('archived channel mutations', () => {
  it('rejects post, join, invite, react, pin and scheduling with channel_archived', async () => {
    await expect(msg.sendMessage(archivedId, ownerId, randomUUID(), 'nope')).rejects.toMatchObject(archived);
    await expect(ch.joinChannel(archivedId, outsiderId)).rejects.toMatchObject(archived);
    await expect(ch.addMember(archivedId, ownerId, outsiderId)).rejects.toMatchObject(archived);
    await expect(rx.addReaction(rootId, ownerId, '👍')).rejects.toMatchObject(archived);
    await expect(msg.pinMessage(rootId, ownerId)).rejects.toMatchObject(archived);
    await expect(
      sched.createScheduledMessage(ownerId, {
        channelId: archivedId,
        body: 'later',
        sendAt: new Date(Date.now() + 3_600_000).toISOString(),
      } as never),
    ).rejects.toMatchObject(archived);
  });
});
