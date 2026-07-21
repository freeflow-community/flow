// First-class AI agents (AGENTS_DESIGN.md): invite / register / authenticate /
// role-guard / remove. DB-backed — runs against a scratch database on the dev
// postgres (docker compose in packages/infra, host port 5442). NATS is not
// required (publishEvent is a no-op without a bus connection).
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';

process.env.DATABASE_URL = process.env.FLOW_TEST_DATABASE_URL
  ?? 'postgres://flow:flow_dev@localhost:5442/flow_agents_test';
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
const ag = await import('../src/services/agents.js');
const ap = await import('../src/services/apps.js');
const { eq, and } = await import('drizzle-orm');

const { users, workspaceMembers, channelMembers, channels, agentInvites, agentTokens } = schema;

let ownerId = '';
let ownerToken = '';
let memberId = '';
let workspaceId = '';

async function registerHuman(email: string, name: string): Promise<{ id: string; token: string }> {
  const res = await auth.register(email, { password: 'password123', displayName: name, autoVerify: true });
  if (!('token' in res)) throw new Error('expected autoVerify session');
  return { id: res.user.id, token: res.token };
}

beforeAll(async () => {
  await migrate(process.env.DATABASE_URL!);
  // rerunnable: wipe everything (cascades cover the rest)
  await db.execute(
    `TRUNCATE users, workspaces, agent_invites, agent_tokens, sessions, invites, pending_signups RESTART IDENTITY CASCADE` as never,
  );
  const owner = await registerHuman('owner@example.test', 'Owner');
  ownerId = owner.id;
  ownerToken = owner.token;
  const member = await registerHuman('member@example.test', 'Member');
  memberId = member.id;
  const wsDto = await ws.createWorkspace(ownerId, 'Agent Test WS', `agents-${Date.now()}`);
  workspaceId = wsDto.id;
  // second human joins the workspace directly (invite plumbing not under test)
  await db.insert(workspaceMembers).values({ workspaceId, userId: memberId, role: 'member' });
});

afterAll(async () => {
  await closeDb();
});

describe('agent invites', () => {
  it('owner mints an invite with a flow-agent- key, 7d expiry', async () => {
    const inv = await ag.createAgentInvite(workspaceId, ownerId, 'RepoBot');
    expect(inv.key.startsWith('flow-agent-')).toBe(true);
    expect(inv.nameHint).toBe('RepoBot');
    const msLeft = new Date(inv.expiresAt).getTime() - Date.now();
    expect(msLeft).toBeGreaterThan(6.9 * 86400_000);
    expect(msLeft).toBeLessThanOrEqual(7 * 86400_000);
    // only the hash is stored
    const row = (await db.select().from(agentInvites).where(eq(agentInvites.id, inv.id)))[0]!;
    expect(row.usedAt).toBeNull();
    expect(row.nameHint).toBe('RepoBot');
  });

  it('plain members cannot mint invites', async () => {
    await expect(ag.createAgentInvite(workspaceId, memberId)).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('agent registration', () => {
  it('register consumes the invite and creates a first-class member', async () => {
    const inv = await ag.createAgentInvite(workspaceId, ownerId);
    const res = await ag.registerAgent({ inviteKey: inv.key, name: 'TestBot', description: 'a test agent' });
    expect(res.agentToken.startsWith('flow-agent-token-')).toBe(true);
    expect(res.user.isAgent).toBe(true);
    expect(res.user.displayName).toBe('TestBot');
    expect(res.user.email).toBe(`agent-${res.user.id}@agents.flow.local`);
    expect(res.workspace.id).toBe(workspaceId);

    const u = (await db.select().from(users).where(eq(users.id, res.user.id)))[0]!;
    expect(u.isAgent).toBe(true);
    expect(u.emailVerifiedAt).not.toBeNull();
    expect(u.statusText).toBe('a test agent');

    // workspace member with role 'member', auto-joined #general
    const m = (
      await db
        .select()
        .from(workspaceMembers)
        .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, res.user.id)))
    )[0]!;
    expect(m.role).toBe('member');
    const general = (
      await db.select().from(channels).where(and(eq(channels.workspaceId, workspaceId), eq(channels.name, 'general')))
    )[0]!;
    const cm = await db
      .select()
      .from(channelMembers)
      .where(and(eq(channelMembers.channelId, general.id), eq(channelMembers.userId, res.user.id)));
    expect(cm.length).toBe(1);

    // invite marked used + linked to the agent user
    const invRow = (await db.select().from(agentInvites).where(eq(agentInvites.id, inv.id)))[0]!;
    expect(invRow.usedAt).not.toBeNull();
    expect(invRow.agentUserId).toBe(res.user.id);
  });

  it('rejects replay of a used invite', async () => {
    const inv = await ag.createAgentInvite(workspaceId, ownerId);
    await ag.registerAgent({ inviteKey: inv.key, name: 'OnceBot' });
    await expect(ag.registerAgent({ inviteKey: inv.key, name: 'TwiceBot' })).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it('rejects an expired invite', async () => {
    const inv = await ag.createAgentInvite(workspaceId, ownerId);
    await db
      .update(agentInvites)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(agentInvites.id, inv.id));
    await expect(ag.registerAgent({ inviteKey: inv.key, name: 'LateBot' })).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it('rejects a garbage key', async () => {
    await expect(ag.registerAgent({ inviteKey: 'flow-agent-nonsense-key-value', name: 'NopeBot' })).rejects.toMatchObject(
      { statusCode: 401 },
    );
  });
});

describe('agent token auth', () => {
  it('authenticate() accepts an agent token and touches last_used_at', async () => {
    const inv = await ag.createAgentInvite(workspaceId, ownerId);
    const res = await ag.registerAgent({ inviteKey: inv.key, name: 'AuthBot' });
    const dto = await auth.authenticate(res.agentToken);
    expect(dto.id).toBe(res.user.id);
    expect(dto.isAgent).toBe(true);
    const tok = (await db.select().from(agentTokens).where(eq(agentTokens.userId, res.user.id)))[0]!;
    expect(tok.lastUsedAt).not.toBeNull();
    expect(tok.revokedAt).toBeNull();
  });

  it('sessions still authenticate (isAgent false for humans)', async () => {
    const dto = await auth.authenticate(ownerToken);
    expect(dto.id).toBe(ownerId);
    expect(dto.isAgent).toBe(false);
  });

  it('rejects unknown and revoked tokens', async () => {
    await expect(auth.authenticate('flow-agent-token-bogus')).rejects.toMatchObject({ statusCode: 401 });
    const inv = await ag.createAgentInvite(workspaceId, ownerId);
    const res = await ag.registerAgent({ inviteKey: inv.key, name: 'RevokedBot' });
    await db.update(agentTokens).set({ revokedAt: new Date() }).where(eq(agentTokens.userId, res.user.id));
    await expect(auth.authenticate(res.agentToken)).rejects.toMatchObject({ statusCode: 401 });
  });
});

describe('role guard', () => {
  it('agents cannot create workspaces, invite, or manage apps/agents', async () => {
    const inv = await ag.createAgentInvite(workspaceId, ownerId);
    const res = await ag.registerAgent({ inviteKey: inv.key, name: 'GuardBot' });
    const agentId = res.user.id;
    await expect(ws.createWorkspace(agentId, 'Agent WS', `agent-ws-${Date.now()}`)).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(ws.createInvite(workspaceId, agentId, 'x@example.test')).rejects.toMatchObject({ statusCode: 403 });
    await expect(ap.listApps(workspaceId, agentId)).rejects.toMatchObject({ statusCode: 403 });
    await expect(ag.createAgentInvite(workspaceId, agentId)).rejects.toMatchObject({ statusCode: 403 });
    await expect(ag.removeAgent(workspaceId, agentId, agentId)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('registered agents are always role member', async () => {
    const inv = await ag.createAgentInvite(workspaceId, ownerId);
    const res = await ag.registerAgent({ inviteKey: inv.key, name: 'RoleBot' });
    const m = (
      await db
        .select()
        .from(workspaceMembers)
        .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, res.user.id)))
    )[0]!;
    expect(m.role).toBe('member');
  });
});

describe('remove agent', () => {
  it('admin removal: leaves workspace + channels, deletes 1:1 DMs, revokes tokens, keeps the user row', async () => {
    const inv = await ag.createAgentInvite(workspaceId, ownerId);
    const res = await ag.registerAgent({ inviteKey: inv.key, name: 'DoomedBot' });
    const agentId = res.user.id;
    const dm = await ch.createDm(workspaceId, ownerId, [agentId]);

    await ag.removeAgent(workspaceId, agentId, ownerId);

    const wm = await db
      .select()
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, agentId)));
    expect(wm.length).toBe(0);
    const cms = await db.select().from(channelMembers).where(eq(channelMembers.userId, agentId));
    expect(cms.length).toBe(0);
    const dmRow = await db.select().from(channels).where(eq(channels.id, dm.id));
    expect(dmRow.length).toBe(0); // 1:1 DM deleted outright
    const toks = await db.select().from(agentTokens).where(eq(agentTokens.userId, agentId));
    expect(toks.every((t) => t.revokedAt !== null)).toBe(true);
    await expect(auth.authenticate(res.agentToken)).rejects.toMatchObject({ statusCode: 401 });
    // user row survives for authorship
    const u = (await db.select().from(users).where(eq(users.id, agentId)))[0];
    expect(u?.displayName).toBe('DoomedBot');
  });

  it('plain members cannot remove agents; removing a human via removeAgent 404s', async () => {
    const inv = await ag.createAgentInvite(workspaceId, ownerId);
    const res = await ag.registerAgent({ inviteKey: inv.key, name: 'SafeBot' });
    await expect(ag.removeAgent(workspaceId, res.user.id, memberId)).rejects.toMatchObject({ statusCode: 403 });
    await expect(ag.removeAgent(workspaceId, memberId, ownerId)).rejects.toMatchObject({ statusCode: 404 });
  });
});
