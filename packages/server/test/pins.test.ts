// Channel-wide pinned messages: member authorization, idempotent pin/unpin,
// hydrated pin metadata, thread support, and deletion cleanup.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';

process.env.DATABASE_URL = process.env.FLOW_TEST_DATABASE_URL
  ?? 'postgres://flow:flow_dev@localhost:5442/flow_pins_test';
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

const { workspaceMembers } = schema;
let ownerId = '';
let memberId = '';
let observerId = '';
let workspaceId = '';

async function register(email: string, displayName: string): Promise<string> {
  const result = await auth.register(email, { password: 'password123', displayName, autoVerify: true });
  if (!('token' in result)) throw new Error('expected auto-verified user');
  return result.user.id;
}

async function room(name: string): Promise<string> {
  const channel = await ch.createChannel(workspaceId, ownerId, `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await ch.addMember(channel.id, ownerId, memberId);
  return channel.id;
}

beforeAll(async () => {
  await migrate(process.env.DATABASE_URL!);
  await db.execute(
    `TRUNCATE users, workspaces, sessions, invites, pending_signups RESTART IDENTITY CASCADE` as never,
  );
  ownerId = await register('pins-owner@example.test', 'Owner');
  memberId = await register('pins-member@example.test', 'Member');
  observerId = await register('pins-observer@example.test', 'Observer');
  workspaceId = (await ws.createWorkspace(ownerId, 'Pins WS', `pins-${Date.now()}`)).id;
  await db.insert(workspaceMembers).values([
    { workspaceId, userId: memberId, role: 'member' },
    { workspaceId, userId: observerId, role: 'member' },
  ]);
});

afterAll(async () => {
  await closeDb();
});

describe('message pins', () => {
  it('pins once for the whole channel and exposes who pinned it', async () => {
    const channelId = await room('shared');
    const sent = await msg.sendMessage(channelId, ownerId, randomUUID(), 'keep this');

    const first = await msg.pinMessage(sent.id, ownerId);
    const again = await msg.pinMessage(sent.id, memberId);
    expect(first.pinnedAt).not.toBeNull();
    expect(first.pinnedBy).toBe(ownerId);
    expect(again.pinnedAt).toBe(first.pinnedAt);
    expect(again.pinnedBy).toBe(ownerId);

    const listed = await msg.listPinnedMessages(channelId, memberId);
    expect(listed.map((m) => m.id)).toEqual([sent.id]);
    expect(listed[0]!.body).toBe('keep this');
    expect(listed[0]!.pinnedBy).toBe(ownerId);
  });

  it('requires channel membership to manage pins, while preserving public-channel read access', async () => {
    const channelId = await room('access');
    const sent = await msg.sendMessage(channelId, ownerId, randomUUID(), 'visible pin');
    await expect(msg.pinMessage(sent.id, observerId)).rejects.toThrow(/join the channel/);

    await msg.pinMessage(sent.id, ownerId);
    expect((await msg.listPinnedMessages(channelId, observerId))[0]!.id).toBe(sent.id);

    const unpinned = await msg.unpinMessage(sent.id, memberId);
    expect(unpinned.pinnedAt).toBeNull();
    expect(await msg.listPinnedMessages(channelId, ownerId)).toEqual([]);
  });

  it('supports thread replies and removes pins when messages are deleted', async () => {
    const channelId = await room('thread');
    const root = await msg.sendMessage(channelId, ownerId, randomUUID(), 'root');
    const reply = await msg.sendMessage(channelId, memberId, randomUUID(), 'important reply', root.id);
    await msg.pinMessage(reply.id, memberId);
    expect((await msg.listPinnedMessages(channelId, ownerId))[0]!.threadRootId).toBe(root.id);

    await msg.deleteMessage(reply.id, memberId);
    expect(await msg.listPinnedMessages(channelId, ownerId)).toEqual([]);
  });
});
