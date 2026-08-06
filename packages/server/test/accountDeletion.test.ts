// Self-service account deletion (DELETE /v1/me, App Store 5.1.1(v)): the user
// leaves every workspace, a departing owner hands off to the longest-standing
// admin/member, and the account is tombstoned — email freed, credentials and
// OAuth identities dropped. DB-backed — runs against a scratch database on the
// dev postgres (docker compose in packages/infra, host port 5442).
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';

process.env.DATABASE_URL = process.env.FLOW_TEST_DATABASE_URL
  ?? 'postgres://flow:flow_dev@localhost:5442/flow_account_deletion_test';
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
const { deleteMyAccount } = await import('../src/services/accountDeletion.js');
const { and, eq } = await import('drizzle-orm');

const { users, workspaceMembers, sessions, oauthIdentities } = schema;

async function registerHuman(email: string, name: string): Promise<{ id: string; token: string }> {
  const res = await auth.register(email, { password: 'password123', displayName: name, autoVerify: true });
  if (!('token' in res)) throw new Error('expected autoVerify session');
  return { id: res.user.id, token: res.token };
}

beforeAll(async () => {
  await migrate(process.env.DATABASE_URL!);
});

beforeEach(async () => {
  await db.execute(
    `TRUNCATE users, workspaces, sessions, invites, pending_signups RESTART IDENTITY CASCADE` as never,
  );
});

afterAll(async () => {
  await closeDb();
});

describe('deleteMyAccount', () => {
  it('tombstones the user, drops credentials + identities, and frees the email', async () => {
    const owner = await registerHuman('owner@example.test', 'Owner');
    const me = await registerHuman('scott@berkeleyzone.test', 'Scott');
    const wsDto = await ws.createWorkspace(owner.id, 'Team', `team-${Date.now()}`);
    await db.insert(workspaceMembers).values({ workspaceId: wsDto.id, userId: me.id, role: 'member' });
    await db.insert(oauthIdentities).values({
      provider: 'google',
      providerSubject: 'sub-123',
      userId: me.id,
      email: 'scott@berkeleyzone.test',
    });

    await deleteMyAccount(me.id);

    const [u] = await db.select().from(users).where(eq(users.id, me.id));
    expect(u!.deletedAt).not.toBeNull();
    expect(u!.email).not.toBe('scott@berkeleyzone.test'); // vacated
    expect(u!.email).toContain(me.id); // unique via id prefix
    expect(u!.avatarUrl).toBeNull();

    const mem = await db.select().from(workspaceMembers).where(eq(workspaceMembers.userId, me.id));
    expect(mem.length).toBe(0);
    const sess = await db.select().from(sessions).where(eq(sessions.userId, me.id));
    expect(sess.length).toBe(0);
    const ids = await db.select().from(oauthIdentities).where(eq(oauthIdentities.userId, me.id));
    expect(ids.length).toBe(0);

    // the old session no longer authenticates
    await expect(auth.authenticate(me.token)).rejects.toThrow();

    // the address re-registers as a fresh account
    const reReg = await registerHuman('scott@berkeleyzone.test', 'Scott Again');
    expect(reReg.id).not.toBe(me.id);
  });

  it('hands a departing owner’s workspace to the longest-standing admin', async () => {
    const owner = await registerHuman('owner@example.test', 'Owner');
    const admin = await registerHuman('admin@example.test', 'Admin');
    const member = await registerHuman('member@example.test', 'Member');
    const wsDto = await ws.createWorkspace(owner.id, 'Team', `team-${Date.now()}`);
    await db.insert(workspaceMembers).values({ workspaceId: wsDto.id, userId: member.id, role: 'member' });
    await db.insert(workspaceMembers).values({ workspaceId: wsDto.id, userId: admin.id, role: 'admin' });

    await deleteMyAccount(owner.id);

    const [next] = await db
      .select()
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, wsDto.id), eq(workspaceMembers.userId, admin.id)));
    expect(next!.role).toBe('owner');
    const [unchanged] = await db
      .select()
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, wsDto.id), eq(workspaceMembers.userId, member.id)));
    expect(unchanged!.role).toBe('member');
  });

  it('falls back to the longest-standing member when there is no admin', async () => {
    const owner = await registerHuman('owner@example.test', 'Owner');
    const member = await registerHuman('member@example.test', 'Member');
    const wsDto = await ws.createWorkspace(owner.id, 'Team', `team-${Date.now()}`);
    await db.insert(workspaceMembers).values({ workspaceId: wsDto.id, userId: member.id, role: 'member' });

    await deleteMyAccount(owner.id);

    const [next] = await db
      .select()
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, wsDto.id), eq(workspaceMembers.userId, member.id)));
    expect(next!.role).toBe('owner');
  });

  it('leaves a sole-member workspace behind without error', async () => {
    const me = await registerHuman('solo@example.test', 'Solo');
    const wsDto = await ws.createWorkspace(me.id, 'Solo WS', `solo-${Date.now()}`);

    await deleteMyAccount(me.id);

    const remaining = await db
      .select()
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, wsDto.id));
    expect(remaining.length).toBe(0);
    const [u] = await db.select().from(users).where(eq(users.id, me.id));
    expect(u!.deletedAt).not.toBeNull();
  });

  it('refuses agents and bots (they have their own removal lifecycle)', async () => {
    const agentId = randomUUID();
    await db.insert(users).values({
      id: agentId,
      email: 'bot@agents.test',
      passwordHash: '!agent:x',
      displayName: 'Bot',
      isAgent: true,
      emailVerifiedAt: new Date(),
    });

    await expect(deleteMyAccount(agentId)).rejects.toThrow(/sponsor/);
    const [u] = await db.select().from(users).where(eq(users.id, agentId));
    expect(u!.deletedAt).toBeNull();
  });

  it('is a 404 for an already-deleted account', async () => {
    const me = await registerHuman('twice@example.test', 'Twice');
    await deleteMyAccount(me.id);
    await expect(deleteMyAccount(me.id)).rejects.toThrow();
  });
});
