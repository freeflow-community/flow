// Privacy mode (#489): a member asks that their email never leave the server
// and that they not be listed in the Directory.
//
// DB-backed against the dev postgres (docker compose in packages/infra, host
// port 5442) like the other service tests, because the point of the feature is
// what the *real* read paths return — a pure test of the helper would prove
// only that the helper works, not that `listMembers` calls it.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';

process.env.DATABASE_URL = process.env.FLOW_TEST_DATABASE_URL
  ?? 'postgres://flow:flow_dev@localhost:5442/flow_privacy_mode_test';
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
const us = await import('../src/services/users.js');
const { eq } = await import('drizzle-orm');

const { users, workspaceMembers } = schema;

let hider = { id: '', email: 'hider@example.test' };
let peer = { id: '', email: 'peer@example.test' };
let wsId = '';

async function registerHuman(email: string, name: string): Promise<string> {
  const res = await auth.register(email, { password: 'password123', displayName: name, autoVerify: true });
  if (!('token' in res)) throw new Error('expected autoVerify session');
  return res.user.id;
}

const memberEmail = async (viewerId: string, userId: string): Promise<string> =>
  (await ws.listMembers(wsId, viewerId)).find((m) => m.userId === userId)!.email;

beforeAll(async () => {
  await migrate(process.env.DATABASE_URL!);
  await db.execute(
    `TRUNCATE users, workspaces, agent_invites, agent_tokens, sessions, invites, pending_signups RESTART IDENTITY CASCADE` as never,
  );
  hider.id = await registerHuman(hider.email, 'Hilda Hider');
  peer.id = await registerHuman(peer.email, 'Pia Peer');
  wsId = (await ws.createWorkspace(hider.id, 'Locked In', `locked-in-${Date.now()}`)).id;
  await db.insert(workspaceMembers).values({ workspaceId: wsId, userId: peer.id, role: 'member' });
});

afterAll(async () => {
  await closeDb();
});

describe('privacy mode: the flag itself', () => {
  it('defaults to off, so every existing account is unaffected', async () => {
    const row = (await db.select().from(users).where(eq(users.id, peer.id)).limit(1))[0]!;
    expect(row.privacyMode).toBe(false);
    expect((await us.getUser(peer.id, hider.id)).privacyMode).toBe(false);
  });

  it('is set through PATCH /v1/me, which only ever writes the caller’s own row', async () => {
    const me = await us.patchMe(hider.id, { privacyMode: true });
    expect(me.privacyMode).toBe(true);
    const stored = (await db.select().from(users).where(eq(users.id, hider.id)).limit(1))[0]!;
    expect(stored.privacyMode).toBe(true);
    // the peer's row was not touched — patchMe takes the session's user id, so
    // there is no parameter through which one member could hide another
    const other = (await db.select().from(users).where(eq(users.id, peer.id)).limit(1))[0]!;
    expect(other.privacyMode).toBe(false);
  });
});

describe('privacy mode: email redaction', () => {
  it('drops the address from the roster a co-member reads', async () => {
    expect(await memberEmail(peer.id, hider.id)).toBe('');
  });

  it('drops it from a profile fetch by anyone else', async () => {
    expect((await us.getUser(hider.id, peer.id)).email).toBe('');
    expect((await us.getUser(hider.id, peer.id)).privacyMode).toBe(true);
  });

  it('leaves the member with their own address, on the roster and on /v1/me', async () => {
    expect(await memberEmail(hider.id, hider.id)).toBe(hider.email);
    expect((await us.getUser(hider.id, hider.id)).email).toBe(hider.email);
  });

  it('leaves a member who has not turned it on completely alone', async () => {
    expect(await memberEmail(hider.id, peer.id)).toBe(peer.email);
    expect((await us.getUser(peer.id, hider.id)).email).toBe(peer.email);
  });

  it('hides nothing once the flag goes back off', async () => {
    await us.patchMe(hider.id, { privacyMode: false });
    expect(await memberEmail(peer.id, hider.id)).toBe(hider.email);
    await us.patchMe(hider.id, { privacyMode: true }); // leave it on for the rest
  });

  it('redacts in a workspace-wide event, which has no single viewer', async () => {
    const row = (await db.select().from(users).where(eq(users.id, hider.id)).limit(1))[0]!;
    expect(auth.toUserDTO(row).email).toBe('');
    expect(auth.toUserDTO(row, hider.id).email).toBe(hider.email);
  });
});
