// First-class AI agents (AGENT_MEMBERS.md): on-demand registration with human
// sponsors — register / approve / poll / login / role-guard / remove /
// sponsor cascade. DB-backed — runs against a scratch database on the dev
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

const { users, workspaceMembers, channelMembers, channels, agentPairingRequests, agentTokens } = schema;

let ownerId = '';
let ownerToken = '';
let memberId = '';
let workspaceId = '';
let seq = 0;

async function registerHuman(email: string, name: string): Promise<{ id: string; token: string }> {
  const res = await auth.register(email, { password: 'password123', displayName: name, autoVerify: true });
  if (!('token' in res)) throw new Error('expected autoVerify session');
  return { id: res.user.id, token: res.token };
}

/** Shorthand: open a pairing request sponsored by the owner. */
async function start(name: string, opts: Partial<Parameters<typeof ag.startAgentRegistration>[0]> = {}) {
  seq += 1;
  const username = (opts.username ?? `${name.toLowerCase()}-${seq}`) as string;
  const key = opts.key ?? `flow-agent-key-${randomBytes(24).toString('base64url')}`;
  const res = await ag.startAgentRegistration({
    username,
    key,
    name,
    sponsorEmail: 'owner@example.test',
    ...opts,
    ...(opts.username ? {} : { username }),
    ...(opts.key ? {} : { key }),
  });
  return { ...res, username, key };
}

/** Full happy path: register → owner approves → poll delivers the token. */
async function registerAgent(name: string) {
  const s = await start(name);
  await ag.approveAgentRequest(s.requestId, ownerId, workspaceId);
  const res = await ag.pollAgentRegistration(s.requestId, s.pollSecret);
  if (res.status !== 'approved' || !res.agentToken || !res.user) throw new Error('expected approved poll');
  return { ...s, agentToken: res.agentToken, user: res.user, workspace: res.workspace! };
}

beforeAll(async () => {
  await migrate(process.env.DATABASE_URL!);
  // rerunnable: wipe everything (cascades cover the rest)
  await db.execute(
    `TRUNCATE users, workspaces, agent_pairing_requests, agent_tokens, sessions, invites, pending_signups RESTART IDENTITY CASCADE` as never,
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

describe('pairing request', () => {
  it('register opens a pending request with a code, 10-minute expiry; poll says pending', async () => {
    const s = await start('PendBot');
    expect(s.code).toMatch(/^[A-Z2-9]{3}-[A-Z2-9]{3}$/);
    expect(s.pollSecret.length).toBeGreaterThan(20);
    const msLeft = new Date(s.expiresAt).getTime() - Date.now();
    expect(msLeft).toBeGreaterThan(9 * 60_000);
    expect(msLeft).toBeLessThanOrEqual(10 * 60_000);
    const poll = await ag.pollAgentRegistration(s.requestId, s.pollSecret);
    expect(poll.status).toBe('pending');
    // no user account exists yet
    const row = (await db.select().from(agentPairingRequests).where(eq(agentPairingRequests.id, s.requestId)))[0]!;
    expect(row.status).toBe('pending');
    expect(row.agentUserId).toBeNull();
    // key stored hashed, never raw
    expect(row.keyHash.startsWith('$argon2')).toBe(true);
  });

  it('a wrong pollSecret is unauthorized', async () => {
    const s = await start('SecretBot');
    await expect(ag.pollAgentRegistration(s.requestId, 'wrong-secret')).rejects.toMatchObject({ statusCode: 401 });
  });

  it('an unknown sponsor email still opens a request (no enumeration), invisible to everyone', async () => {
    const s = await start('GhostBot', { sponsorEmail: 'nobody@example.test' });
    expect(s.code).toBeTruthy();
    const poll = await ag.pollAgentRegistration(s.requestId, s.pollSecret);
    expect(poll.status).toBe('pending');
    const mine = await ag.listPairingRequests(ownerId);
    expect(mine.find((r) => r.id === s.requestId)).toBeUndefined();
  });

  it('the sponsor sees their pending requests', async () => {
    const s = await start('ListBot');
    const mine = await ag.listPairingRequests(ownerId);
    const found = mine.find((r) => r.id === s.requestId);
    expect(found?.name).toBe('ListBot');
    expect(found?.code).toBe(s.code);
    // other users see nothing
    const theirs = await ag.listPairingRequests(memberId);
    expect(theirs.find((r) => r.id === s.requestId)).toBeUndefined();
  });

  it('a taken username is rejected up front', async () => {
    const a = await registerAgent('DupBot');
    await expect(
      ag.startAgentRegistration({
        username: a.username, // same username as the approved agent
        key: `flow-agent-key-${randomBytes(24).toString('base64url')}`,
        name: 'DupBot2',
        sponsorEmail: 'owner@example.test',
      }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'username_taken' });
  });
});

describe('approval', () => {
  it('approve creates a first-class member with sponsor + credentials; poll delivers the token once', async () => {
    const s = await start('TestBot', { description: 'a test agent' });
    await ag.approveAgentRequest(s.requestId, ownerId, workspaceId);
    const poll = await ag.pollAgentRegistration(s.requestId, s.pollSecret);
    expect(poll.status).toBe('approved');
    expect(poll.agentToken).toMatch(/^flow-agent-token-/);
    expect(poll.user!.isAgent).toBe(true);
    expect(poll.user!.displayName).toBe('TestBot');
    expect(poll.workspace!.id).toBe(workspaceId);

    const u = (await db.select().from(users).where(eq(users.id, poll.user!.id)))[0]!;
    expect(u.isAgent).toBe(true);
    expect(u.sponsorUserId).toBe(ownerId);
    expect(u.agentUsername).toBe(s.username);
    expect(u.agentKeyHash?.startsWith('$argon2')).toBe(true);
    expect(u.emailVerifiedAt).not.toBeNull();
    expect(u.statusText).toBe('a test agent');

    // workspace member with role 'member', auto-joined #general
    const m = (
      await db
        .select()
        .from(workspaceMembers)
        .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, poll.user!.id)))
    )[0]!;
    expect(m.role).toBe('member');
    const general = (
      await db.select().from(channels).where(and(eq(channels.workspaceId, workspaceId), eq(channels.name, 'general')))
    )[0]!;
    const cm = await db
      .select()
      .from(channelMembers)
      .where(and(eq(channelMembers.channelId, general.id), eq(channelMembers.userId, poll.user!.id)));
    expect(cm.length).toBe(1);

    // the token is delivered exactly once
    const again = await ag.pollAgentRegistration(s.requestId, s.pollSecret);
    expect(again.status).toBe('approved');
    expect(again.agentToken).toBeUndefined();
  });

  it('the sponsor can pick a preset avatar at approval; bogus presets are rejected up front', async () => {
    const s = await start('AvatarBot');
    await ag.approveAgentRequest(s.requestId, ownerId, workspaceId, 'robot-03');
    const poll = await ag.pollAgentRegistration(s.requestId, s.pollSecret);
    // preset ran through the normal avatar pipeline → ordinary /v1/avatars URL
    expect(poll.user!.avatarUrl).toMatch(/^\/v1\/avatars\//);
    const s2 = await start('AvatarBot2');
    await expect(ag.approveAgentRequest(s2.requestId, ownerId, workspaceId, 'robot-99')).rejects.toMatchObject({
      statusCode: 404,
    });
    // the failed approve consumed nothing — still approvable without a preset
    await ag.approveAgentRequest(s2.requestId, ownerId, workspaceId);
  });

  it('only the named sponsor can approve or deny (others get 404)', async () => {
    const s = await start('OtherBot');
    await expect(ag.approveAgentRequest(s.requestId, memberId, workspaceId)).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(ag.denyAgentRequest(s.requestId, memberId)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('deny ends the request; approval afterwards fails', async () => {
    const s = await start('DeniedBot');
    await ag.denyAgentRequest(s.requestId, ownerId);
    const poll = await ag.pollAgentRegistration(s.requestId, s.pollSecret);
    expect(poll.status).toBe('denied');
    await expect(ag.approveAgentRequest(s.requestId, ownerId, workspaceId)).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('an expired request polls as expired and cannot be approved', async () => {
    const s = await start('LateBot');
    await db
      .update(agentPairingRequests)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(agentPairingRequests.id, s.requestId));
    const poll = await ag.pollAgentRegistration(s.requestId, s.pollSecret);
    expect(poll.status).toBe('expired');
    await expect(ag.approveAgentRequest(s.requestId, ownerId, workspaceId)).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('the sponsor must be a member of the chosen workspace', async () => {
    const s = await start('WsBot');
    const stranger = await ws.createWorkspace(memberId, 'Members Own WS', `member-ws-${Date.now()}`);
    // owner is not a member of the member's workspace (membership privacy: 404)
    await expect(ag.approveAgentRequest(s.requestId, ownerId, stranger.id)).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe('agent token auth + login', () => {
  it('authenticate() accepts a delivered agent token and touches last_used_at', async () => {
    const a = await registerAgent('AuthBot');
    const dto = await auth.authenticate(a.agentToken);
    expect(dto.id).toBe(a.user.id);
    expect(dto.isAgent).toBe(true);
    const tok = (await db.select().from(agentTokens).where(eq(agentTokens.userId, a.user.id)))[0]!;
    expect(tok.lastUsedAt).not.toBeNull();
    expect(tok.revokedAt).toBeNull();
  });

  it('sessions still authenticate (isAgent false for humans)', async () => {
    const dto = await auth.authenticate(ownerToken);
    expect(dto.id).toBe(ownerId);
    expect(dto.isAgent).toBe(false);
  });

  it('login with username+key revokes the old token and mints a working new one', async () => {
    const a = await registerAgent('LoginBot');
    const res = await ag.agentLogin(a.username, a.key);
    expect(res.agentToken).toMatch(/^flow-agent-token-/);
    expect(res.agentToken).not.toBe(a.agentToken);
    await expect(auth.authenticate(a.agentToken)).rejects.toMatchObject({ statusCode: 401 });
    const dto = await auth.authenticate(res.agentToken);
    expect(dto.id).toBe(a.user.id);
  });

  it('login rejects a wrong key or unknown username', async () => {
    const a = await registerAgent('WrongKeyBot');
    await expect(ag.agentLogin(a.username, 'flow-agent-key-totally-wrong')).rejects.toMatchObject({
      statusCode: 401,
    });
    await expect(ag.agentLogin('no-such-agent', 'flow-agent-key-whatever00')).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it('rejects unknown and revoked tokens', async () => {
    await expect(auth.authenticate('flow-agent-token-bogus')).rejects.toMatchObject({ statusCode: 401 });
    const a = await registerAgent('RevokedBot');
    await db.update(agentTokens).set({ revokedAt: new Date() }).where(eq(agentTokens.userId, a.user.id));
    await expect(auth.authenticate(a.agentToken)).rejects.toMatchObject({ statusCode: 401 });
  });
});

describe('role guard', () => {
  it('agents cannot create workspaces, invite, or manage apps; approved agents are always role member', async () => {
    const a = await registerAgent('GuardBot');
    const agentId = a.user.id;
    await expect(ws.createWorkspace(agentId, 'Agent WS', `agent-ws-${Date.now()}`)).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(ws.createInvite(workspaceId, agentId, 'x@example.test')).rejects.toMatchObject({ statusCode: 403 });
    await expect(ap.listApps(workspaceId, agentId)).rejects.toMatchObject({ statusCode: 403 });
    const m = (
      await db
        .select()
        .from(workspaceMembers)
        .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, agentId)))
    )[0]!;
    expect(m.role).toBe('member');
  });
});

describe('remove agent', () => {
  it('admin removal: leaves workspace + channels, deletes 1:1 DMs, revokes tokens AND credentials, keeps the user row', async () => {
    const a = await registerAgent('DoomedBot');
    const agentId = a.user.id;
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
    await expect(auth.authenticate(a.agentToken)).rejects.toMatchObject({ statusCode: 401 });
    // credentials are dead: login can never resurrect a removed agent
    await expect(ag.agentLogin(a.username, a.key)).rejects.toMatchObject({ statusCode: 401 });
    // user row survives for authorship
    const u = (await db.select().from(users).where(eq(users.id, agentId)))[0];
    expect(u?.displayName).toBe('DoomedBot');
    expect(u?.agentUsername).toBeNull();
  });

  it('the sponsor can remove their own agent without being admin', async () => {
    // member sponsors an agent into the shared workspace
    const s = await start('MemberBot', { sponsorEmail: 'member@example.test' });
    await ag.approveAgentRequest(s.requestId, memberId, workspaceId);
    const poll = await ag.pollAgentRegistration(s.requestId, s.pollSecret);
    const agentId = poll.user!.id;
    // an unrelated non-admin cannot remove it… (owner-sponsored path checked above)
    const bystander = await registerHuman(`bystander-${Date.now()}@example.test`, 'Bystander');
    await db.insert(workspaceMembers).values({ workspaceId, userId: bystander.id, role: 'member' });
    await expect(ag.removeAgent(workspaceId, agentId, bystander.id)).rejects.toMatchObject({ statusCode: 403 });
    // …but the sponsor (plain member) can
    await ag.removeAgent(workspaceId, agentId, memberId);
    const wm = await db
      .select()
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, agentId)));
    expect(wm.length).toBe(0);
  });

  it('removing a human via removeAgent 404s', async () => {
    await expect(ag.removeAgent(workspaceId, memberId, ownerId)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('sponsor departure cascade', () => {
  it('removing the sponsor from a workspace removes the agents they sponsor there', async () => {
    const sponsor = await registerHuman(`sponsor-${Date.now()}@example.test`, 'Sponsor');
    await db.insert(workspaceMembers).values({ workspaceId, userId: sponsor.id, role: 'member' });
    const s = await ag.startAgentRegistration({
      username: `cascadebot-${Date.now()}`,
      key: `flow-agent-key-${randomBytes(24).toString('base64url')}`,
      name: 'CascadeBot',
      sponsorEmail: (await db.select().from(users).where(eq(users.id, sponsor.id)))[0]!.email,
    });
    await ag.approveAgentRequest(s.requestId, sponsor.id, workspaceId);
    const poll = await ag.pollAgentRegistration(s.requestId, s.pollSecret);
    const agentId = poll.user!.id;

    await ws.removeMember(workspaceId, ownerId, sponsor.id);

    const wm = await db
      .select()
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, agentId)));
    expect(wm.length).toBe(0);
    await expect(auth.authenticate(poll.agentToken!)).rejects.toMatchObject({ statusCode: 401 });
    const u = (await db.select().from(users).where(eq(users.id, agentId)))[0]!;
    expect(u.agentUsername).toBeNull(); // credentials dead too
  });
});
