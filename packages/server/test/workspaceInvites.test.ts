// Invite a person into another of your workspaces from their profile popup
// (#359), and the picker both that and the agent path share (#358).
//
// DB-backed against the dev postgres (docker compose in packages/infra, host
// port 5442), like the other service tests. NATS isn't required.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';

process.env.DATABASE_URL = process.env.FLOW_TEST_DATABASE_URL
  ?? 'postgres://flow:flow_dev@localhost:5442/flow_wsinvites_test';
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
const wi = await import('../src/services/workspaceInvites.js');
const ag = await import('../src/services/agents.js');
const msg = await import('../src/services/messages.js');
const { and, eq } = await import('drizzle-orm');

const { invites, users, workspaceMembers, channels, channelMembers, messages } = schema;

let alice = { id: '', token: '' };
let bob = { id: '', token: '' };
let shared = ''; // Alice + Bob both in here
let acme = ''; // Alice only
let seq = 0;

async function registerHuman(email: string, name: string): Promise<{ id: string; token: string }> {
  const res = await auth.register(email, { password: 'password123', displayName: name, autoVerify: true });
  if (!('token' in res)) throw new Error('expected autoVerify session');
  return { id: res.user.id, token: res.token };
}

function uniq(): number {
  seq += 1;
  return seq;
}

beforeAll(async () => {
  await migrate(process.env.DATABASE_URL!);
  await db.execute(
    `TRUNCATE users, workspaces, agent_invites, agent_tokens, sessions, invites, pending_signups RESTART IDENTITY CASCADE` as never,
  );
  alice = await registerHuman('alice@example.test', 'Alice');
  bob = await registerHuman('bob@example.test', 'Bob');
  shared = (await ws.createWorkspace(alice.id, 'Shared', `shared-${Date.now()}`)).id;
  await db.insert(workspaceMembers).values({ workspaceId: shared, userId: bob.id, role: 'member' });
  acme = (await ws.createWorkspace(alice.id, 'Acme', `acme-${Date.now()}`)).id;
});

afterAll(async () => {
  await closeDb();
});

describe('invite targets (#358 picker)', () => {
  it('lists the viewer’s workspaces the subject is not in yet', async () => {
    const { workspaces } = await wi.workspaceInviteTargets(bob.id, alice.id);
    expect(workspaces.map((w) => w.id)).toEqual([acme]);
  });

  it('is empty when the subject is already everywhere the viewer is', async () => {
    const { workspaces } = await wi.workspaceInviteTargets(alice.id, bob.id);
    expect(workspaces).toEqual([]);
  });

  it('404s for someone the viewer shares no workspace with', async () => {
    const carol = await registerHuman(`carol-${uniq()}@example.test`, 'Carol');
    await expect(wi.workspaceInviteTargets(carol.id, alice.id)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('lists agents the same way people are listed', async () => {
    const inv = await ag.createAgentInvite(shared, alice.id);
    const agent = await ag.redeemAgentInvite({
      code: inv.code,
      username: `picker-${uniq()}-${Date.now()}`,
      key: `flow-agent-key-${randomBytes(24).toString('base64url')}`,
      name: 'PickerBot',
    });
    const { workspaces } = await wi.workspaceInviteTargets(agent.user.id, alice.id);
    expect(workspaces.map((w) => w.id)).toEqual([acme]);
  });
});

describe('inviting a person (#359)', () => {
  it('creates a pending invitation, DMs them, and adds no membership', async () => {
    const dave = await registerHuman(`dave-${uniq()}@example.test`, 'Dave');
    await db.insert(workspaceMembers).values({ workspaceId: shared, userId: dave.id, role: 'member' });

    const { invite, created } = await wi.inviteUserToWorkspace(dave.id, acme, alice.id);
    expect(created).toBe(true);
    expect(invite.workspaceId).toBe(acme);
    expect(invite.workspaceName).toBe('Acme');
    expect(invite.inviterName).toBe('Alice');
    // 7-day expiry, same as every other invite
    const days = (new Date(invite.expiresAt).getTime() - Date.now()) / 86400_000;
    expect(days).toBeGreaterThan(6);
    expect(days).toBeLessThanOrEqual(7);

    const member = await db
      .select()
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, acme), eq(workspaceMembers.userId, dave.id)));
    expect(member.length).toBe(0); // consent first

    // the ping is an ordinary DM from the inviter, in the workspace they share
    const dmRows = await db
      .select({ id: channels.id, kind: channels.kind })
      .from(channelMembers)
      .innerJoin(channels, eq(channels.id, channelMembers.channelId))
      .where(and(eq(channelMembers.userId, dave.id), eq(channels.workspaceId, shared), eq(channels.kind, 'dm')));
    expect(dmRows.length).toBe(1);
    const list = await msg.listMessages(dmRows[0]!.id, dave.id, undefined, 20);
    expect(list.messages.some((m) => m.body.includes('Acme') && m.userId === alice.id)).toBe(true);
  });

  it('shows up in the invitee’s pending list and nobody else’s', async () => {
    const erin = await registerHuman(`erin-${uniq()}@example.test`, 'Erin');
    await db.insert(workspaceMembers).values({ workspaceId: shared, userId: erin.id, role: 'member' });
    await wi.inviteUserToWorkspace(erin.id, acme, alice.id);

    const mine = await wi.listMyWorkspaceInvites(erin.id);
    expect(mine.map((i) => i.workspaceId)).toContain(acme);
    expect(await wi.listMyWorkspaceInvites(alice.id)).toEqual([]);
  });

  it('is idempotent — asking twice returns the invitation already in flight', async () => {
    const frank = await registerHuman(`frank-${uniq()}@example.test`, 'Frank');
    await db.insert(workspaceMembers).values({ workspaceId: shared, userId: frank.id, role: 'member' });
    const first = await wi.inviteUserToWorkspace(frank.id, acme, alice.id);
    const second = await wi.inviteUserToWorkspace(frank.id, acme, alice.id);
    expect(first.created).toBe(true);
    // idempotent, and it says so: the second call did not send anything
    expect(second.created).toBe(false);
    expect(second.invite.id).toBe(first.invite.id);
    expect(second.invite.workspaceName).toBe('Acme');
    const rows = await db
      .select()
      .from(invites)
      .where(and(eq(invites.workspaceId, acme), eq(invites.invitedUserId, frank.id)));
    expect(rows.length).toBe(1);
  });

  it('rejects an existing member with already_member', async () => {
    await expect(wi.inviteUserToWorkspace(bob.id, shared, alice.id)).rejects.toMatchObject({
      statusCode: 409,
      code: 'already_member',
    });
  });

  it('404s when the caller does not belong to the target workspace', async () => {
    const grace = await registerHuman(`grace-${uniq()}@example.test`, 'Grace');
    const hers = (await ws.createWorkspace(grace.id, 'Hers', `hers-${uniq()}-${Date.now()}`)).id;
    await expect(wi.inviteUserToWorkspace(bob.id, hers, alice.id)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('404s for a person the caller shares no workspace with', async () => {
    const heidi = await registerHuman(`heidi-${uniq()}@example.test`, 'Heidi');
    await expect(wi.inviteUserToWorkspace(heidi.id, acme, alice.id)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('accepting and declining (#359)', () => {
  async function invitee(name: string) {
    const u = await registerHuman(`${name}-${uniq()}@example.test`, name);
    await db.insert(workspaceMembers).values({ workspaceId: shared, userId: u.id, role: 'member' });
    const { invite } = await wi.inviteUserToWorkspace(u.id, acme, alice.id);
    return { ...u, invite };
  }

  it('accept → membership + #general + a join line in the target workspace', async () => {
    const ivan = await invitee('ivan');
    const wsDto = await ws.acceptInvite(ivan.id, { inviteId: ivan.invite.id });
    expect(wsDto.id).toBe(acme);

    const member = await db
      .select()
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, acme), eq(workspaceMembers.userId, ivan.id)));
    expect(member.length).toBe(1);

    const general = (
      await db.select().from(channels).where(and(eq(channels.workspaceId, acme), eq(channels.name, 'general')))
    )[0]!;
    const cm = await db
      .select()
      .from(channelMembers)
      .where(and(eq(channelMembers.channelId, general.id), eq(channelMembers.userId, ivan.id)));
    expect(cm.length).toBe(1);
    const joinLines = await db
      .select()
      .from(messages)
      .where(and(eq(messages.channelId, general.id), eq(messages.userId, ivan.id)));
    expect(joinLines.length).toBe(1);
    expect(joinLines[0]!.systemKind).toBe('member_joined');

    expect(await wi.listMyWorkspaceInvites(ivan.id)).toEqual([]);
  });

  it('decline → no membership, no announcement, and the card is gone', async () => {
    const judy = await invitee('judy');
    const general = (
      await db.select().from(channels).where(and(eq(channels.workspaceId, acme), eq(channels.name, 'general')))
    )[0]!;

    await ws.declineInvite(judy.id, judy.invite.id);

    const member = await db
      .select()
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, acme), eq(workspaceMembers.userId, judy.id)));
    expect(member.length).toBe(0);
    const joinLines = await db
      .select()
      .from(messages)
      .where(and(eq(messages.channelId, general.id), eq(messages.userId, judy.id)));
    expect(joinLines.length).toBe(0);
    expect(await wi.listMyWorkspaceInvites(judy.id)).toEqual([]);
    await expect(ws.acceptInvite(judy.id, { inviteId: judy.invite.id })).rejects.toMatchObject({ statusCode: 409 });
  });

  it('declining frees the slot, so they can be invited again', async () => {
    const karl = await invitee('karl');
    await ws.declineInvite(karl.id, karl.invite.id);
    const again = await wi.inviteUserToWorkspace(karl.id, acme, alice.id);
    expect(again.created).toBe(true);
    expect(again.invite.id).not.toBe(karl.invite.id);
    expect((await wi.listMyWorkspaceInvites(karl.id)).length).toBe(1);
  });

  it('an invitation addressed to someone else is not acceptable by id', async () => {
    const liam = await invitee('liam');
    await expect(ws.acceptInvite(bob.id, { inviteId: liam.invite.id })).rejects.toMatchObject({ statusCode: 404 });
    await expect(ws.declineInvite(bob.id, liam.invite.id)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('an expired invitation is neither listed nor acceptable', async () => {
    const mia = await invitee('mia');
    await db
      .update(invites)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invites.id, mia.invite.id));
    expect(await wi.listMyWorkspaceInvites(mia.id)).toEqual([]);
    await expect(ws.acceptInvite(mia.id, { inviteId: mia.invite.id })).rejects.toMatchObject({
      statusCode: 400,
      code: 'invite_expired',
    });
  });

  it('the emailed token path still works unchanged', async () => {
    const email = `nina-${uniq()}@example.test`;
    const nina = await registerHuman(email, 'Nina');
    const dto = await ws.createInvite(acme, alice.id, email);
    const token = dto.inviteUrl.slice(dto.inviteUrl.lastIndexOf('/') + 1);
    const joined = await ws.acceptInvite(nina.id, { token });
    expect(joined.id).toBe(acme);
  });
});
