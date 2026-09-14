// Channel emoji (#396): the persistent glyph after a channel's name — the write
// path's authorization and validation, that it lands on the channel list, and
// that it is a column and not the TTL'd thing it shares a sidebar slot with.
//
// Same scratch-database setup as the other service tests (docker compose in
// packages/infra, host port 5442).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';

process.env.DATABASE_URL = process.env.FLOW_TEST_DATABASE_URL
  ?? 'postgres://flow:flow_dev@localhost:5442/flow_channel_emoji_test';
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

const { migrate } = await import('../src/db/migrate.js');
const { db, schema, closeDb } = await import('../src/db/index.js');
const { SetChannelEmojiBody, isSingleEmoji } = await import('@flow/shared');
const auth = await import('../src/services/auth.js');
const ws = await import('../src/services/workspaces.js');
const ch = await import('../src/services/channels.js');
const ce = await import('../src/services/channelEmoji.js');
const { eq } = await import('drizzle-orm');

const { channels, workspaceMembers } = schema;

let aliceId = '';
let agentId = ''; // channel member
let outsiderId = ''; // workspace member, not in `channelId`
let workspaceId = '';
let channelId = '';
let privateId = ''; // private channel: alice only

async function register(email: string, displayName: string): Promise<string> {
  const res = await auth.register(email, { password: 'password123', displayName, autoVerify: true });
  if (!('token' in res)) throw new Error('expected autoVerify session');
  return res.user.id;
}

beforeAll(async () => {
  await migrate(process.env.DATABASE_URL!);
  await db.execute(`TRUNCATE users, workspaces, sessions, invites, pending_signups RESTART IDENTITY CASCADE` as never);
  aliceId = await register('alice@example.test', 'Alice');
  agentId = await register('robo@example.test', 'Robo');
  outsiderId = await register('outsider@example.test', 'Outsider');

  const w = await ws.createWorkspace(aliceId, 'Emoji Test', `emo-${randomUUID().slice(0, 8)}`);
  workspaceId = w.id;
  for (const uid of [agentId, outsiderId]) {
    await db.insert(workspaceMembers).values({ workspaceId, userId: uid, role: 'member' });
  }
  const chan = await ch.createChannel(workspaceId, aliceId, 'work');
  channelId = chan.id;
  await ch.addMember(channelId, aliceId, agentId);

  const priv = await ch.createChannel(workspaceId, aliceId, 'secret', undefined, true);
  privateId = priv.id;
});

afterAll(async () => {
  await closeDb();
});

describe('emoji validation', () => {
  it('accepts one emoji, including ZWJ sequences and skin tones', () => {
    for (const e of ['🔥', '🚧', '✅', '👍🏿', '👩🏽‍🚀', '🏳️‍🌈']) expect(isSingleEmoji(e)).toBe(true);
  });

  it('rejects text, mixtures and more than one emoji', () => {
    for (const bad of ['x', 'building', '🔥🔥', '🔥 ', 'a🔥', '']) expect(isSingleEmoji(bad)).toBe(false);
  });

  it('the request body rejects a non-emoji and accepts a clear', () => {
    expect(SetChannelEmojiBody.safeParse({ emoji: 'nope' }).success).toBe(false);
    expect(SetChannelEmojiBody.safeParse({ emoji: '🔥🔥' }).success).toBe(false);
    expect(SetChannelEmojiBody.safeParse({ emoji: '🔥' }).success).toBe(true);
    expect(SetChannelEmojiBody.safeParse({ emoji: null }).success).toBe(true);
    expect(SetChannelEmojiBody.safeParse({ emoji: '' }).success).toBe(true);
    expect(SetChannelEmojiBody.safeParse({}).success).toBe(true);
  });
});

describe('setChannelEmoji', () => {
  it('sets, replaces and clears', async () => {
    expect(await ce.setChannelEmoji(channelId, agentId, '🔥')).toEqual({ emoji: '🔥' });
    expect(await ce.setChannelEmoji(channelId, agentId, '🚧')).toEqual({ emoji: '🚧' });
    expect(await ce.setChannelEmoji(channelId, agentId, null)).toEqual({ emoji: null });
    expect(await ce.setChannelEmoji(channelId, agentId, '✅')).toEqual({ emoji: '✅' });
    expect(await ce.setChannelEmoji(channelId, agentId, '')).toEqual({ emoji: null }); // empty clears too
  });

  it('persists to the row, not to memory — a restart keeps it', async () => {
    await ce.setChannelEmoji(channelId, agentId, '🔥');
    const row = (await db.select().from(channels).where(eq(channels.id, channelId)).limit(1))[0];
    expect(row?.emoji).toBe('🔥');
    await ce.setChannelEmoji(channelId, agentId, null);
  });

  it('rides along on the channel list, and disappears when cleared', async () => {
    await ce.setChannelEmoji(channelId, agentId, '🚧');
    const listed = (await ch.listChannels(workspaceId, aliceId)).find((c) => c.id === channelId);
    expect(listed?.emoji).toBe('🚧');

    await ce.setChannelEmoji(channelId, agentId, null);
    const after = (await ch.listChannels(workspaceId, aliceId)).find((c) => c.id === channelId);
    expect(after?.emoji ?? null).toBeNull();
  });

  it('refuses a workspace member who is not in the channel', async () => {
    await expect(ce.setChannelEmoji(channelId, outsiderId, '🔥')).rejects.toThrow(/only channel members/i);
    const row = (await db.select().from(channels).where(eq(channels.id, channelId)).limit(1))[0];
    expect(row?.emoji ?? null).toBeNull();
  });

  it('will not admit a private channel it cannot see, let alone decorate it', async () => {
    await expect(ce.setChannelEmoji(privateId, outsiderId, '🔥')).rejects.toThrow(/not found/i);
  });

  it('rejects an unknown channel', async () => {
    await expect(ce.setChannelEmoji(randomUUID(), agentId, '🔥')).rejects.toThrow(/not found/i);
  });

  it('rejects a non-emoji at the service, not only at the route', async () => {
    await expect(ce.setChannelEmoji(channelId, agentId, 'building')).rejects.toThrow(/single emoji/i);
    await expect(ce.setChannelEmoji(channelId, agentId, '🔥🔥')).rejects.toThrow(/single emoji/i);
  });
});
