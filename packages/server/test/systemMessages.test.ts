// Join/leave system messages (ui_nits): joining/leaving a standard channel
// posts an inline "X joined/left the channel" notice (systemKind set), and those
// notices never contribute to unread counts. DB-backed against the dev postgres
// (docker compose in packages/infra, host port 5442); NATS not required.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';

process.env.DATABASE_URL = process.env.FLOW_TEST_DATABASE_URL
  ?? 'postgres://flow:flow_dev@localhost:5442/flow_system_test';
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

async function registerHuman(email: string, name: string): Promise<string> {
  const res = await auth.register(email, { password: 'password123', displayName: name, autoVerify: true });
  if (!('token' in res)) throw new Error('expected autoVerify session');
  return res.user.id;
}

/** Newest-first messages of a channel. */
async function messagesOf(channelId: string, userId: string) {
  return (await msg.listMessages(channelId, userId, undefined, 50)).messages;
}

async function unreadFor(userId: string, channelId: string): Promise<number> {
  const list = await ch.listChannels(workspaceId, userId);
  return list.find((c) => c.id === channelId)?.unreadCount ?? -1;
}

beforeAll(async () => {
  await migrate(process.env.DATABASE_URL!);
  await db.execute(
    `TRUNCATE users, workspaces, sessions, invites, pending_signups RESTART IDENTITY CASCADE` as never,
  );
  ownerId = await registerHuman('owner@example.test', 'Owner');
  memberId = await registerHuman('member@example.test', 'Member');
  observerId = await registerHuman('observer@example.test', 'Observer');
  const wsDto = await ws.createWorkspace(ownerId, 'System Msg WS', `sysmsg-${Date.now()}`);
  workspaceId = wsDto.id;
  await db.insert(workspaceMembers).values([
    { workspaceId, userId: memberId, role: 'member' },
    { workspaceId, userId: observerId, role: 'member' },
  ]);
});

afterAll(async () => {
  await closeDb();
});

describe('join/leave system messages', () => {
  it('joining a standard channel posts a "joined" notice authored by the joiner', async () => {
    const chan = await ch.createChannel(workspaceId, ownerId, 'sysroom');
    await ch.joinChannel(chan.id, memberId);
    const rows = await messagesOf(chan.id, ownerId);
    const notice = rows.find((m) => m.systemKind === 'member_joined');
    expect(notice).toBeDefined();
    expect(notice!.userId).toBe(memberId);
    expect(notice!.body).toBe('Member joined the channel');
  });

  it('leaving a standard channel posts a "left" notice', async () => {
    const chan = await ch.createChannel(workspaceId, ownerId, 'leaveroom');
    await ch.joinChannel(chan.id, memberId);
    await ch.removeMember(chan.id, memberId, memberId); // self-leave
    const rows = await messagesOf(chan.id, ownerId);
    const left = rows.find((m) => m.systemKind === 'member_left');
    expect(left).toBeDefined();
    expect(left!.body).toBe('Member left the channel');
  });

  it('accepting a workspace invite posts a "joined" notice in #general', async () => {
    const newcomerId = await registerHuman('newcomer@example.test', 'Newcomer');
    const inv = await ws.createInvite(workspaceId, ownerId, 'newcomer@example.test');
    const token = inv.inviteUrl.slice(inv.inviteUrl.lastIndexOf('/') + 1);
    await ws.acceptInvite(newcomerId, { token });
    const general = (await ch.listChannels(workspaceId, ownerId)).find((c) => c.name === 'general')!;
    const rows = await messagesOf(general.id, ownerId);
    const notice = rows.find((m) => m.systemKind === 'member_joined' && m.userId === newcomerId);
    expect(notice).toBeDefined();
    expect(notice!.body).toBe('Newcomer joined the channel');
  });

  it('redeeming a join link posts the notice once, not again on a second redeem', async () => {
    const linkerId = await registerHuman('linker@example.test', 'Linker');
    const link = await ws.createJoinLink(workspaceId, ownerId);
    const token = link.joinUrl!.slice(link.joinUrl!.lastIndexOf('/') + 1);
    await ws.redeemJoinLink(linkerId, token);
    await ws.redeemJoinLink(linkerId, token);
    const general = (await ch.listChannels(workspaceId, ownerId)).find((c) => c.name === 'general')!;
    const rows = await messagesOf(general.id, ownerId);
    const notices = rows.filter((m) => m.systemKind === 'member_joined' && m.userId === linkerId);
    expect(notices).toHaveLength(1);
    expect(notices[0]!.body).toBe('Linker joined the channel');
  });

  it('system notices do not contribute to unread counts', async () => {
    const chan = await ch.createChannel(workspaceId, ownerId, 'unreadroom');
    await ch.joinChannel(chan.id, observerId);
    // catch the observer up to the newest row (their own join notice)
    const newest = (await messagesOf(chan.id, observerId))[0]!;
    await ch.markRead(chan.id, observerId, newest.id);
    expect(await unreadFor(observerId, chan.id)).toBe(0);

    // a third party joining posts a system line — must NOT bump unread
    await ch.joinChannel(chan.id, memberId);
    expect(await unreadFor(observerId, chan.id)).toBe(0);

    // a real message DOES bump it
    await msg.sendMessage(chan.id, ownerId, randomUUID(), 'hello everyone');
    expect(await unreadFor(observerId, chan.id)).toBe(1);
  });
});
