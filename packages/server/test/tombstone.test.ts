// Last-workspace tombstone (decision_log 2026-07-21): removing a human from
// their only workspace marks the user dead and vacates the email so it can be
// re-registered; the row stays for message authorship. DB-backed — runs against
// a scratch database on the dev postgres (docker compose in packages/infra,
// host port 5442). NATS is not required (publishEvent no-ops without a bus).
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';

process.env.DATABASE_URL = process.env.FLOW_TEST_DATABASE_URL
  ?? 'postgres://flow:flow_dev@localhost:5442/flow_tombstone_test';
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
const { eq } = await import('drizzle-orm');

const { users, workspaceMembers, sessions } = schema;

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

describe('last-workspace tombstone', () => {
  it('tombstones a human removed from their only workspace and frees the email', async () => {
    const owner = await registerHuman('owner@example.test', 'Owner');
    const member = await registerHuman('scott@berkeleyzone.test', 'Scott');
    const wsDto = await ws.createWorkspace(owner.id, 'Solo WS', `solo-${Date.now()}`);
    await db.insert(workspaceMembers).values({ workspaceId: wsDto.id, userId: member.id, role: 'member' });

    await ws.removeMember(wsDto.id, owner.id, member.id);

    const [u] = await db.select().from(users).where(eq(users.id, member.id));
    expect(u).toBeTruthy(); // row kept so authored messages keep their name
    expect(u!.deletedAt).not.toBeNull(); // marked dead
    expect(u!.email).not.toBe('scott@berkeleyzone.test'); // original address vacated
    expect(u!.email).toContain('scott@berkeleyzone.test'); // ...but preserved for audit
    expect(u!.email).toContain(member.id); // ...and unique via the id prefix

    // membership + sessions gone (removeMemberDeep + tombstone credential wipe)
    const mem = await db.select().from(workspaceMembers).where(eq(workspaceMembers.userId, member.id));
    expect(mem.length).toBe(0);
    const sess = await db.select().from(sessions).where(eq(sessions.userId, member.id));
    expect(sess.length).toBe(0);

    // the whole point: the original email re-registers as a fresh account
    const reReg = await registerHuman('scott@berkeleyzone.test', 'Scott Again');
    expect(reReg.id).not.toBe(member.id);
  });

  it('does NOT tombstone when the member still belongs to another workspace', async () => {
    const owner = await registerHuman('owner@example.test', 'Owner');
    const member = await registerHuman('multi@example.test', 'Multi');
    const ws1 = await ws.createWorkspace(owner.id, 'WS One', `one-${Date.now()}`);
    const ws2 = await ws.createWorkspace(owner.id, 'WS Two', `two-${Date.now()}`);
    await db.insert(workspaceMembers).values({ workspaceId: ws1.id, userId: member.id, role: 'member' });
    await db.insert(workspaceMembers).values({ workspaceId: ws2.id, userId: member.id, role: 'member' });

    await ws.removeMember(ws1.id, owner.id, member.id);

    const [u] = await db.select().from(users).where(eq(users.id, member.id));
    expect(u!.deletedAt).toBeNull();
    expect(u!.email).toBe('multi@example.test');
    // still a member of ws2
    const mem = await db.select().from(workspaceMembers).where(eq(workspaceMembers.userId, member.id));
    expect(mem.length).toBe(1);
    expect(mem[0]!.workspaceId).toBe(ws2.id);
  });

  it('does NOT tombstone a bot/agent removed through this path', async () => {
    const owner = await registerHuman('owner@example.test', 'Owner');
    const wsDto = await ws.createWorkspace(owner.id, 'Bot WS', `bot-${Date.now()}`);
    const agentId = randomUUID();
    await db.insert(users).values({
      id: agentId,
      email: 'bot@agents.test',
      passwordHash: '!agent:x',
      displayName: 'Bot',
      isAgent: true,
      emailVerifiedAt: new Date(),
    });
    await db.insert(workspaceMembers).values({ workspaceId: wsDto.id, userId: agentId, role: 'member' });

    await ws.removeMember(wsDto.id, owner.id, agentId);

    const [u] = await db.select().from(users).where(eq(users.id, agentId));
    expect(u!.deletedAt).toBeNull(); // agents keep their removeAgent/deleteApp lifecycle
    expect(u!.email).toBe('bot@agents.test');
  });
});
