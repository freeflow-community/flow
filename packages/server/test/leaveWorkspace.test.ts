// Self-service workspace departure (#340): POST /v1/workspaces/:id/leave.
// The member goes, their messages stay, the owner is refused, and the account
// survives even when it was the last workspace. DB-backed — runs against a
// scratch database on the dev postgres (docker compose in packages/infra, host
// port 5442). NATS is not required (publishEvent is a no-op without a bus).
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';

process.env.DATABASE_URL = process.env.FLOW_TEST_DATABASE_URL
  ?? 'postgres://flow:flow_dev@localhost:5442/flow_leave_workspace_test';
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
const ag = await import('../src/services/agents.js');
const { and, eq } = await import('drizzle-orm');

const { users, workspaceMembers, channelMembers, invites } = schema;

let seq = 0;

async function registerHuman(name: string): Promise<{ id: string; token: string }> {
  seq += 1;
  const res = await auth.register(`${name.toLowerCase()}-${seq}@example.test`, {
    password: 'password123',
    displayName: name,
    autoVerify: true,
  });
  if (!('token' in res)) throw new Error('expected autoVerify session');
  return { id: res.user.id, token: res.token };
}

/** Owner + a plain member in a fresh workspace — the shape every test starts from. */
async function setup() {
  const owner = await registerHuman('Owner');
  const member = await registerHuman('Member');
  seq += 1;
  const workspace = await ws.createWorkspace(owner.id, 'Team', `team-${seq}-${randomBytes(3).toString('hex')}`);
  await db.transaction(async (tx) => ws.enrollInWorkspace(tx, workspace.id, member.id));
  return { owner, member, workspaceId: workspace.id };
}

beforeAll(async () => {
  await migrate(process.env.DATABASE_URL!);
});

beforeEach(async () => {
  await db.execute(
    `TRUNCATE users, workspaces, sessions, invites, pending_signups RESTART IDENTITY CASCADE` as never,
  );
  seq = 0;
});

afterAll(async () => {
  await closeDb();
});

describe('leaveWorkspace', () => {
  it('removes a non-owner from the workspace and all of its channels', async () => {
    const { member, workspaceId } = await setup();
    const before = await ch.listChannels(workspaceId, member.id);
    expect(before.length).toBeGreaterThan(0); // #general, auto-joined

    await ws.leaveWorkspace(workspaceId, member.id);

    const membership = await db
      .select()
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, member.id)));
    expect(membership).toHaveLength(0);
    const chanMemberships = await db.select().from(channelMembers).where(eq(channelMembers.userId, member.id));
    expect(chanMemberships).toHaveLength(0);
  });

  it('drops the workspace from the leaver and rejects workspace-scoped calls afterwards', async () => {
    const { member, workspaceId } = await setup();
    expect((await ws.myWorkspaces(member.id)).map((w) => w.id)).toContain(workspaceId);

    await ws.leaveWorkspace(workspaceId, member.id);

    expect((await ws.myWorkspaces(member.id)).map((w) => w.id)).not.toContain(workspaceId);
    // Reads and writes scoped to the workspace are refused — 404 rather than
    // 403 by requireMembership's design, which declines to leak existence.
    await expect(ws.getWorkspace(workspaceId, member.id)).rejects.toMatchObject({ statusCode: 404 });
    await expect(ws.listMembers(workspaceId, member.id)).rejects.toMatchObject({ statusCode: 404 });
    await expect(ch.listChannels(workspaceId, member.id)).rejects.toMatchObject({ statusCode: 404 });
    await expect(ch.createChannel(workspaceId, member.id, 'nope', '', false)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('leaves the departed member\'s messages in place, still attributed to them', async () => {
    const { owner, member, workspaceId } = await setup();
    const general = (await ch.listChannels(workspaceId, member.id))[0]!;
    const sent = await msg.sendMessage(general.id, member.id, randomUUID(), 'so long');

    await ws.leaveWorkspace(workspaceId, member.id);

    const page = await msg.listMessages(general.id, owner.id, undefined, 50);
    const kept = page.messages.find((m) => m.id === sent.id);
    expect(kept?.body).toBe('so long');
    expect(kept?.userId).toBe(member.id);
    // The author row survives untombstoned, so the name still renders.
    const [row] = await db.select().from(users).where(eq(users.id, member.id));
    expect(row?.displayName).toBe('Member');
    expect(row?.deletedAt).toBeNull();
  });

  it('refuses the workspace owner', async () => {
    const { owner, workspaceId } = await setup();
    await expect(ws.leaveWorkspace(workspaceId, owner.id)).rejects.toMatchObject({
      statusCode: 403,
      message: expect.stringContaining('transfer ownership'),
    });
    const still = await db
      .select()
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, owner.id)));
    expect(still).toHaveLength(1);
  });

  it('lets an admin leave — only the owner is pinned', async () => {
    const { owner, member, workspaceId } = await setup();
    await ws.setMemberRole(workspaceId, owner.id, member.id, 'admin');
    await expect(ws.leaveWorkspace(workspaceId, member.id)).resolves.toBeUndefined();
  });

  it('refuses a non-member', async () => {
    const { workspaceId } = await setup();
    const stranger = await registerHuman('Stranger');
    await expect(ws.leaveWorkspace(workspaceId, stranger.id)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('keeps the account alive when it was the last workspace (no tombstone)', async () => {
    const { member, workspaceId } = await setup();
    await ws.leaveWorkspace(workspaceId, member.id);

    const [row] = await db.select().from(users).where(eq(users.id, member.id));
    expect(row?.deletedAt).toBeNull();
    expect(row?.email).not.toContain('tombstone+'); // admin removal would have
    expect(await ws.myWorkspaces(member.id)).toHaveLength(0); // signed in, empty state
  });

  it('takes the leaver\'s sponsored agents with them', async () => {
    const { member, workspaceId } = await setup();
    const inv = await ag.createAgentInvite(workspaceId, member.id);
    const agent = await ag.redeemAgentInvite({
      code: inv.code,
      username: `helper-${randomBytes(3).toString('hex')}`,
      key: `flow-agent-key-${randomBytes(24).toString('base64url')}`,
      name: 'Helper',
    });

    await ws.leaveWorkspace(workspaceId, member.id);

    const agentMembership = await db
      .select()
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, agent.user.id)));
    expect(agentMembership).toHaveLength(0);
  });

  it('refuses an agent — those are removed by their sponsor', async () => {
    const { owner, workspaceId } = await setup();
    const inv = await ag.createAgentInvite(workspaceId, owner.id);
    const agent = await ag.redeemAgentInvite({
      code: inv.code,
      username: `bot-${randomBytes(3).toString('hex')}`,
      key: `flow-agent-key-${randomBytes(24).toString('base64url')}`,
      name: 'Bot',
    });
    await expect(ws.leaveWorkspace(workspaceId, agent.user.id)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('leaves a pending invite for the departed user intact, and re-joining works', async () => {
    const { owner, member, workspaceId } = await setup();
    const [memberRow] = await db.select().from(users).where(eq(users.id, member.id));
    await ws.leaveWorkspace(workspaceId, member.id);

    const invite = await ws.createInvite(workspaceId, owner.id, memberRow!.email);
    const pending = await db.select().from(invites).where(eq(invites.workspaceId, workspaceId));
    expect(pending).toHaveLength(1);

    const token = invite.inviteUrl.slice(invite.inviteUrl.lastIndexOf('/') + 1);
    const rejoined = await ws.acceptInvite(member.id, token);
    expect(rejoined.id).toBe(workspaceId);
    expect((await ws.myWorkspaces(member.id)).map((w) => w.id)).toContain(workspaceId);
  });
});
