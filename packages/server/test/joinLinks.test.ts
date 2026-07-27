// Persistent workspace join links (issue #85): mint / read back / one-at-a-time
// regeneration / revoke / redeem / permissions. DB-backed — runs against a
// scratch database on the dev postgres (docker compose in packages/infra, host
// port 5442). NATS is not required (publishEvent is a no-op without a bus).
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';

process.env.DATABASE_URL = process.env.FLOW_TEST_DATABASE_URL
  ?? 'postgres://flow:flow_dev@localhost:5442/flow_joinlinks_test';
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
const { eq, and } = await import('drizzle-orm');

const { workspaceMembers, channelMembers, channels } = schema;

let ownerId = '';
let adminId = '';
let memberId = '';
let outsiderId = '';
let workspaceId = '';
let slug = '';

async function registerHuman(email: string, name: string): Promise<string> {
  const res = await auth.register(email, { password: 'password123', displayName: name, autoVerify: true });
  if (!('token' in res)) throw new Error('expected autoVerify session');
  return res.user.id;
}

/** The token is the last path segment of the shared URL. */
function tokenOf(url: string): string {
  return url.slice(url.lastIndexOf('/') + 1);
}

beforeAll(async () => {
  await migrate(process.env.DATABASE_URL!);
  await db.execute(
    `TRUNCATE users, workspaces, workspace_join_links, sessions, invites, pending_signups RESTART IDENTITY CASCADE` as never,
  );
  ownerId = await registerHuman('owner@example.test', 'Owner');
  adminId = await registerHuman('admin@example.test', 'Admin');
  memberId = await registerHuman('member@example.test', 'Member');
  outsiderId = await registerHuman('outsider@example.test', 'Outsider');
  slug = `joinlinks-${Date.now()}`;
  const wsDto = await ws.createWorkspace(ownerId, 'Join Link Test WS', slug);
  workspaceId = wsDto.id;
  await db.insert(workspaceMembers).values({ workspaceId, userId: adminId, role: 'admin' });
  await db.insert(workspaceMembers).values({ workspaceId, userId: memberId, role: 'member' });
});

afterAll(async () => {
  await closeDb();
});

describe('managing the link', () => {
  it('starts with no link', async () => {
    expect(await ws.getJoinLink(workspaceId, ownerId)).toMatchObject({ workspaceId, joinUrl: null });
  });

  it('an owner mints a link whose URL carries the workspace slug', async () => {
    const link = await ws.createJoinLink(workspaceId, ownerId);
    expect(link.joinUrl).toContain(`/join/${slug}/`);
    expect(tokenOf(link.joinUrl!).length).toBeGreaterThanOrEqual(16);
    expect(link.createdBy).toBe(ownerId);
  });

  it('reads back the SAME link later — it is persistent, not shown-once', async () => {
    const first = await ws.createJoinLink(workspaceId, ownerId);
    expect((await ws.getJoinLink(workspaceId, ownerId)).joinUrl).toBe(first.joinUrl);
    expect((await ws.getJoinLink(workspaceId, adminId)).joinUrl).toBe(first.joinUrl);
  });

  it('regenerating replaces the link: one live at a time, and the old URL dies', async () => {
    const first = await ws.createJoinLink(workspaceId, ownerId);
    const second = await ws.createJoinLink(workspaceId, adminId);
    expect(second.joinUrl).not.toBe(first.joinUrl);
    expect((await ws.getJoinLink(workspaceId, ownerId)).joinUrl).toBe(second.joinUrl);
    await expect(ws.redeemJoinLink(outsiderId, tokenOf(first.joinUrl!))).rejects.toMatchObject({ statusCode: 404 });
  });

  it('revoking clears it, and revoking again is a no-op', async () => {
    await ws.createJoinLink(workspaceId, ownerId);
    expect(await ws.revokeJoinLink(workspaceId, ownerId)).toMatchObject({ joinUrl: null });
    expect((await ws.getJoinLink(workspaceId, ownerId)).joinUrl).toBeNull();
    await expect(ws.revokeJoinLink(workspaceId, ownerId)).resolves.toMatchObject({ joinUrl: null });
  });

  it('a plain member can neither read nor mint nor revoke the link (403)', async () => {
    await ws.createJoinLink(workspaceId, ownerId);
    await expect(ws.getJoinLink(workspaceId, memberId)).rejects.toMatchObject({ statusCode: 403 });
    await expect(ws.createJoinLink(workspaceId, memberId)).rejects.toMatchObject({ statusCode: 403 });
    await expect(ws.revokeJoinLink(workspaceId, memberId)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('a non-member gets 404, not 403 (membership privacy)', async () => {
    await expect(ws.getJoinLink(workspaceId, outsiderId)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('using the link', () => {
  it('previews the workspace unauthenticated so the landing page can name it', async () => {
    const link = await ws.createJoinLink(workspaceId, ownerId);
    expect(await ws.previewJoinLink(tokenOf(link.joinUrl!))).toMatchObject({ workspaceId, slug, name: 'Join Link Test WS' });
  });

  it('redeeming joins the workspace and #general', async () => {
    const link = await ws.createJoinLink(workspaceId, ownerId);
    const joined = await ws.redeemJoinLink(outsiderId, tokenOf(link.joinUrl!));
    expect(joined.id).toBe(workspaceId);
    expect(joined.role).toBe('member');

    const m = await db
      .select()
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, outsiderId)));
    expect(m).toHaveLength(1);

    const general = (
      await db.select().from(channels).where(and(eq(channels.workspaceId, workspaceId), eq(channels.name, 'general')))
    )[0]!;
    const inGeneral = await db
      .select()
      .from(channelMembers)
      .where(and(eq(channelMembers.channelId, general.id), eq(channelMembers.userId, outsiderId)));
    expect(inGeneral).toHaveLength(1);
  });

  it('the link keeps working for the next person — it is not single-use', async () => {
    const link = await ws.createJoinLink(workspaceId, ownerId);
    const token = tokenOf(link.joinUrl!);
    const first = await registerHuman(`first-${Date.now()}@example.test`, 'First');
    const second = await registerHuman(`second-${Date.now()}@example.test`, 'Second');
    await ws.redeemJoinLink(first, token);
    await expect(ws.redeemJoinLink(second, token)).resolves.toMatchObject({ id: workspaceId });
  });

  it('redeeming as an existing member is idempotent', async () => {
    const link = await ws.createJoinLink(workspaceId, ownerId);
    const token = tokenOf(link.joinUrl!);
    await expect(ws.redeemJoinLink(memberId, token)).resolves.toMatchObject({ id: workspaceId, role: 'member' });
    const m = await db
      .select()
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, memberId)));
    expect(m).toHaveLength(1);
    // an owner redeeming their own link keeps their role
    await expect(ws.redeemJoinLink(ownerId, token)).resolves.toMatchObject({ role: 'owner' });
  });

  it('a revoked link cannot be previewed or redeemed', async () => {
    const link = await ws.createJoinLink(workspaceId, ownerId);
    const token = tokenOf(link.joinUrl!);
    await ws.revokeJoinLink(workspaceId, ownerId);
    await expect(ws.previewJoinLink(token)).rejects.toMatchObject({ statusCode: 404 });
    await expect(ws.redeemJoinLink(outsiderId, token)).rejects.toMatchObject({ statusCode: 404 });
  });
});
