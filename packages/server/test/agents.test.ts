// First-class AI agents (AGENT_MEMBERS.md): invite-code onboarding — mint /
// redeem / single-use / login / role-guard / remove / sponsor cascade. DB-backed
// — runs against a scratch database on the dev postgres (docker compose in
// packages/infra, host port 5442). NATS is not required (publishEvent is a
// no-op without a bus connection).
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
const { hashToken } = await import('../src/lib/tokens.js');
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
let seq = 0;

async function registerHuman(email: string, name: string): Promise<{ id: string; token: string }> {
  const res = await auth.register(email, { password: 'password123', displayName: name, autoVerify: true });
  if (!('token' in res)) throw new Error('expected autoVerify session');
  return { id: res.user.id, token: res.token };
}

/** A fresh agent secret key. */
function newKey(): string {
  return `flow-agent-key-${randomBytes(24).toString('base64url')}`;
}

/** Full happy path: sponsor mints a code → agent redeems it → joined + token. */
async function registerAgent(
  name: string,
  opts: { sponsorId?: string; wsId?: string; username?: string } = {},
) {
  seq += 1;
  const username = opts.username ?? `${name.toLowerCase()}-${seq}`;
  const key = newKey();
  const inv = await ag.createAgentInvite(opts.wsId ?? workspaceId, opts.sponsorId ?? ownerId);
  const res = await ag.redeemAgentInvite({ code: inv.code, username, key, name });
  return { ...res, username, key, invite: inv };
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

describe('invite code', () => {
  it('a member mints a one-time code + command with a ~7-day expiry', async () => {
    const inv = await ag.createAgentInvite(workspaceId, ownerId);
    expect(inv.code).toMatch(/^flow-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(inv.command).toBe(`npx flow-agent-bridge ${inv.code}`);
    const msLeft = new Date(inv.expiresAt).getTime() - Date.now();
    expect(msLeft).toBeGreaterThan(6 * 86400_000);
    expect(msLeft).toBeLessThanOrEqual(7 * 86400_000);
    // only the hash is stored, never the raw code
    const row = (await db.select().from(agentInvites).where(eq(agentInvites.workspaceId, workspaceId)).limit(1))[0]!;
    expect(row.redeemedAt).toBeNull();
  });

  it('a non-member cannot mint a code for a workspace (membership privacy: 404)', async () => {
    const stranger = await ws.createWorkspace(memberId, 'Members Own WS', `member-ws-${Date.now()}`);
    await expect(ag.createAgentInvite(stranger.id, ownerId)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('redeem creates a first-class member with sponsor + credentials + random avatar; joins #general', async () => {
    const inv = await ag.createAgentInvite(workspaceId, ownerId);
    const key = newKey();
    const res = await ag.redeemAgentInvite({ code: inv.code, username: 'redeembot', key, name: 'RedeemBot', description: 'a test agent' });
    expect(res.agentToken).toMatch(/^flow-agent-token-/);
    expect(res.user.isAgent).toBe(true);
    expect(res.user.displayName).toBe('RedeemBot');
    expect(res.workspace.id).toBe(workspaceId);
    // random preset ran through the normal avatar pipeline → ordinary /v1/avatars URL
    expect(res.user.avatarUrl).toMatch(/^\/v1\/avatars\//);

    const u = (await db.select().from(users).where(eq(users.id, res.user.id)))[0]!;
    expect(u.isAgent).toBe(true);
    expect(u.sponsorUserId).toBe(ownerId);
    expect(u.agentUsername).toBe('redeembot');
    expect(u.agentKeyHash?.startsWith('$argon2')).toBe(true);
    expect(u.emailVerifiedAt).not.toBeNull();
    expect(u.statusText).toBe('a test agent');

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

    // the invite is now marked redeemed and records what it created
    const row = (await db.select().from(agentInvites).where(eq(agentInvites.codeHash, hashToken(inv.code))))[0]!;
    expect(row.redeemedAt).not.toBeNull();
    expect(row.agentUserId).toBe(res.user.id);
  });

  it('a code can only be used once', async () => {
    const inv = await ag.createAgentInvite(workspaceId, ownerId);
    await ag.redeemAgentInvite({ code: inv.code, username: 'oncebot', key: newKey(), name: 'OnceBot' });
    await expect(
      ag.redeemAgentInvite({ code: inv.code, username: 'oncebot2', key: newKey(), name: 'OnceBot2' }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'invite_used' });
  });

  it('an expired code is rejected', async () => {
    const inv = await ag.createAgentInvite(workspaceId, ownerId);
    await db.update(agentInvites).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(agentInvites.codeHash, hashToken(inv.code)));
    await expect(
      ag.redeemAgentInvite({ code: inv.code, username: 'latebot', key: newKey(), name: 'LateBot' }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'invite_expired' });
  });

  it('an unknown code is not found', async () => {
    await expect(
      ag.redeemAgentInvite({ code: 'flow-AAAA-AAAA', username: 'ghostbot', key: newKey(), name: 'GhostBot' }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('a taken username is rejected', async () => {
    const a = await registerAgent('DupBot');
    const inv = await ag.createAgentInvite(workspaceId, ownerId);
    await expect(
      ag.redeemAgentInvite({ code: inv.code, username: a.username, key: newKey(), name: 'DupBot2' }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'username_taken' });
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
  it('agents cannot create workspaces, invite, or manage apps; redeemed agents are always role member', async () => {
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
    const a = await registerAgent('MemberBot', { sponsorId: memberId });
    const agentId = a.user.id;
    // an unrelated non-admin cannot remove it…
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

  it('admin-panel removal (removeMember) revokes tokens and credentials too', async () => {
    const a = await registerAgent('PanelBot');
    await ws.removeMember(workspaceId, ownerId, a.user.id);
    const wm = await db
      .select()
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, a.user.id)));
    expect(wm.length).toBe(0);
    await expect(auth.authenticate(a.agentToken)).rejects.toMatchObject({ statusCode: 401 });
    await expect(ag.agentLogin(a.username, a.key)).rejects.toMatchObject({ statusCode: 401 });
    // never tombstoned: the row survives untouched for authorship
    const u = (await db.select().from(users).where(eq(users.id, a.user.id)))[0]!;
    expect(u.deletedAt).toBeNull();
    expect(u.agentUsername).toBeNull();
  });
});

// Backs the flow MCP `create_channel` / `invite_to_channel` tools (issue #65):
// agents are ordinary workspace members, so no new authorization model — these
// pin the behaviour the tools surface to agents.
describe('agent channel creation + invites', () => {
  it('an agent creates a public channel and is a member of it', async () => {
    const a = await registerAgent('ChannelBot');
    const name = `agent-made-${Date.now()}`;
    const chan = await ch.createChannel(workspaceId, a.user.id, name, 'spun up by an agent');

    expect(chan.name).toBe(name);
    expect(chan.isPrivate).toBe(false);
    expect(chan.createdBy).toBe(a.user.id);
    expect(chan.isMember).toBe(true);
    const cm = await db
      .select()
      .from(channelMembers)
      .where(and(eq(channelMembers.channelId, chan.id), eq(channelMembers.userId, a.user.id)));
    expect(cm.length).toBe(1);
  });

  it('an agent adds a workspace member to a public channel', async () => {
    const a = await registerAgent('InviteBot');
    const chan = await ch.createChannel(workspaceId, a.user.id, `agent-invites-${Date.now()}`);

    await ch.addMember(chan.id, a.user.id, memberId);

    const cm = await db
      .select()
      .from(channelMembers)
      .where(and(eq(channelMembers.channelId, chan.id), eq(channelMembers.userId, memberId)));
    expect(cm.length).toBe(1);
    // adding the same person again is a no-op, not an error (tool reports success)
    await expect(ch.addMember(chan.id, a.user.id, memberId)).resolves.toBeUndefined();
  });

  it('an agent cannot invite to a private channel it is not in — 404, not 403 (membership privacy)', async () => {
    const a = await registerAgent('OutsiderBot');
    const secret = await ch.createChannel(workspaceId, ownerId, `owner-only-${Date.now()}`, undefined, true);

    // requireChannelAccess 404s before the private-channel forbidden() is reached,
    // so the tool must not promise a 403 here.
    await expect(ch.addMember(secret.id, a.user.id, memberId)).rejects.toMatchObject({
      statusCode: 404,
      code: 'not_found',
    });
    // ...but a member of that private channel may invite
    await expect(ch.addMember(secret.id, ownerId, memberId)).resolves.toBeUndefined();
  });

  it('an agent gets a clean 409 channel_exists on a duplicate channel name', async () => {
    const a = await registerAgent('DupeBot');
    const name = `dupe-${Date.now()}`;
    const first = await ch.createChannel(workspaceId, a.user.id, name);

    await expect(ch.createChannel(workspaceId, a.user.id, name)).rejects.toMatchObject({
      statusCode: 409,
      code: 'channel_exists',
    });
    // the tool recovers the existing id from the channel list to hand back
    const listed = (await ch.listChannels(workspaceId, a.user.id)).find((c) => c.name === name);
    expect(listed?.id).toBe(first.id);
  });
});

describe('sponsor departure cascade', () => {
  it('removing the sponsor from a workspace removes the agents they sponsor there', async () => {
    const sponsor = await registerHuman(`sponsor-${Date.now()}@example.test`, 'Sponsor');
    await db.insert(workspaceMembers).values({ workspaceId, userId: sponsor.id, role: 'member' });
    const a = await registerAgent('CascadeBot', { sponsorId: sponsor.id });
    const agentId = a.user.id;

    await ws.removeMember(workspaceId, ownerId, sponsor.id);

    const wm = await db
      .select()
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, agentId)));
    expect(wm.length).toBe(0);
    await expect(auth.authenticate(a.agentToken)).rejects.toMatchObject({ statusCode: 401 });
    const u = (await db.select().from(users).where(eq(users.id, agentId)))[0]!;
    expect(u.agentUsername).toBeNull(); // credentials dead too
  });
});
