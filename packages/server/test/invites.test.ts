// Batch email invites (#577): one POST /v1/workspaces/:id/invites carrying many
// addresses, each with its own outcome.
//
// The whole point of the feature is that it does NOT fail whole — a typo in one
// address must not cost the others their invite — so these go through the real
// app with app.inject(), with a fake EmailSender standing in for delivery so
// "did N emails actually go out?" is a thing the test can assert.
//
// DB-backed — scratch database on the dev postgres (docker compose in
// packages/infra, host port 5442).
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

process.env.DATABASE_URL = process.env.FLOW_TEST_DATABASE_URL
  ?? 'postgres://flow:flow_dev@localhost:5442/flow_invites_test';
process.env.FLOW_DATA_KEY = randomBytes(32).toString('base64');

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
const { buildApp } = await import('../src/app.js');
const { _setEmailSenderForTests } = await import('../src/email/index.js');
const auth = await import('../src/services/auth.js');
const ws = await import('../src/services/workspaces.js');
const { and, eq, isNull } = await import('drizzle-orm');

const { invites, workspaceMembers } = schema;

let app: FastifyInstance;
let ownerId = '';
let ownerToken = '';
let memberToken = '';
let workspaceId = '';

/** Every address the fake sender was handed, in order. */
let sent: { to: string; subject: string; text: string }[] = [];
/** Addresses the fake sender refuses, standing in for a delivery failure. */
let bounce = new Set<string>();

async function registerHuman(email: string, name: string): Promise<{ id: string; token: string }> {
  const res = await auth.register(email, { password: 'password123', displayName: name, autoVerify: true });
  if (!('token' in res)) throw new Error('expected autoVerify session');
  return { id: res.user.id, token: res.token };
}

function authed(token: string) {
  return { authorization: `Bearer ${token}` };
}

/** POST the invite route with whatever body the caller wants to prove works. */
async function post(body: unknown, token = ownerToken) {
  return app.inject({
    method: 'POST',
    url: `/v1/workspaces/${workspaceId}/invites`,
    headers: authed(token),
    payload: body as object,
  });
}

/** Pending invite rows for an address — the duplicate check. */
async function pendingRows(email: string) {
  return db
    .select({ id: invites.id, tokenHash: invites.tokenHash })
    .from(invites)
    .where(and(eq(invites.workspaceId, workspaceId), eq(invites.email, email), isNull(invites.acceptedAt)));
}

beforeAll(async () => {
  await migrate(process.env.DATABASE_URL!);
  await db.execute(`TRUNCATE users, workspaces, sessions, invites, pending_signups RESTART IDENTITY CASCADE` as never);
  const owner = await registerHuman('owner@example.test', 'Owner');
  const member = await registerHuman('member@example.test', 'Member');
  ownerId = owner.id;
  ownerToken = owner.token;
  memberToken = member.token;
  const wsDto = await ws.createWorkspace(ownerId, 'Invite Test WS', `invites-${Date.now()}`);
  workspaceId = wsDto.id;
  await db.insert(workspaceMembers).values({ workspaceId, userId: member.id, role: 'member' });

  _setEmailSenderForTests({
    async send(msg) {
      if (bounce.has(msg.to)) throw new Error(`simulated bounce for ${msg.to}`);
      sent.push(msg);
    },
  });
  app = buildApp();
});

afterAll(async () => {
  _setEmailSenderForTests(null);
  await app?.close();
  await closeDb();
});

beforeEach(async () => {
  sent = [];
  bounce = new Set();
  await db.delete(invites);
});

describe('batch invites', () => {
  it('sends one email per address and reports every one of them', async () => {
    const emails = ['a@example.test', 'b@example.test', 'c@example.test'];
    const res = await post({ emails });

    expect(res.statusCode).toBe(201);
    const { results } = res.json() as { results: { email: string; status: string; inviteUrl?: string }[] };
    expect(results.map((r) => [r.email, r.status])).toEqual(emails.map((e) => [e, 'sent']));
    expect(sent.map((m) => m.to)).toEqual(emails);
    // each email carries that address's own accept link
    for (const m of sent) expect(m.text).toContain('/invite/');
    expect(new Set(sent.map((m) => m.text.match(/\/invite\/(\S+)/)![1])).size).toBe(3);
    for (const r of results) expect(r.inviteUrl).toBeTruthy();
  });

  // The acceptance criterion: partial success. A bad address in the middle of
  // the list is that address's problem, not the batch's.
  it('partially succeeds across valid / invalid / already-member / pending addresses', async () => {
    await post({ emails: ['pending@example.test'] }); // seed a pending invite to resend
    sent = [];

    const res = await post({
      emails: ['fresh@example.test', 'not-an-email', 'member@example.test', 'pending@example.test'],
    });

    expect(res.statusCode).toBe(201);
    const { results } = res.json() as { results: { email: string; status: string; inviteUrl?: string }[] };
    expect(results).toEqual([
      expect.objectContaining({ email: 'fresh@example.test', status: 'sent' }),
      expect.objectContaining({ email: 'not-an-email', status: 'invalid_email' }),
      expect.objectContaining({ email: 'member@example.test', status: 'already_member' }),
      expect.objectContaining({ email: 'pending@example.test', status: 'resent' }),
    ]);
    // nothing was created for the two that failed, so there is no link to hand back
    expect(results[1]!.inviteUrl).toBeUndefined();
    expect(results[2]!.inviteUrl).toBeUndefined();
    // and only the two real invites were emailed
    expect(sent.map((m) => m.to)).toEqual(['fresh@example.test', 'pending@example.test']);
  });

  it('reports email_failed with a usable inviteUrl when delivery fails', async () => {
    bounce.add('bounces@example.test');
    const res = await post({ emails: ['bounces@example.test', 'ok@example.test'] });

    const { results } = res.json() as { results: { email: string; status: string; inviteUrl?: string }[] };
    expect(results[0]).toMatchObject({ email: 'bounces@example.test', status: 'email_failed' });
    expect(results[0]!.inviteUrl).toContain('/');
    expect(results[1]).toMatchObject({ email: 'ok@example.test', status: 'sent' });
    // the invite is still valid — a failed send is not a failed invite
    expect(await pendingRows('bounces@example.test')).toHaveLength(1);
  });

  it('replaces rather than duplicates a pending invite, and mints a new token', async () => {
    await post({ emails: ['again@example.test'] });
    const [first] = await pendingRows('again@example.test');

    const res = await post({ emails: ['again@example.test'] });
    expect((res.json() as { results: { status: string }[] }).results[0]!.status).toBe('resent');

    const rows = await pendingRows('again@example.test');
    expect(rows).toHaveLength(1); // one pending invite per address, still
    expect(rows[0]!.id).not.toBe(first!.id);
    expect(rows[0]!.tokenHash).not.toBe(first!.tokenHash); // re-emailed link is live
    expect(sent.map((m) => m.to)).toEqual(['again@example.test', 'again@example.test']);
  });

  it('de-duplicates the same address pasted twice, case-insensitively', async () => {
    const res = await post({ emails: ['Dup@example.test', 'dup@example.test', ' dup@example.test '] });

    const { results } = res.json() as { results: { email: string; status: string }[] };
    expect(results).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect(await pendingRows('dup@example.test')).toHaveLength(1);
  });

  it('still refuses a plain member (403) and rejects a body with neither field (400)', async () => {
    expect((await post({ emails: ['x@example.test'] }, memberToken)).statusCode).toBe(403);
    expect((await post({})).statusCode).toBe(400);
    expect(sent).toHaveLength(0);
  });
});

describe('legacy single-email invites', () => {
  it('returns the unchanged InviteDTO shape, not a results list', async () => {
    const res = await post({ email: 'solo@example.test' });

    expect(res.statusCode).toBe(201);
    const dto = res.json() as Record<string, unknown>;
    expect(dto).toMatchObject({ workspaceId, email: 'solo@example.test', emailSent: true });
    expect(dto.id).toBeTruthy();
    expect(dto.inviteUrl).toBeTruthy();
    expect(dto.expiresAt).toBeTruthy();
    expect(dto.results).toBeUndefined();
    expect(dto.status).toBeUndefined();
    expect(sent.map((m) => m.to)).toEqual(['solo@example.test']);
  });

  it('still 409s on an already-member address instead of reporting it', async () => {
    const res = await post({ email: 'member@example.test' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: 'already_member' } });
  });

  it('still 400s on a malformed address', async () => {
    expect((await post({ email: 'not-an-email' })).statusCode).toBe(400);
  });

  it('emailSent is false when delivery fails, and the invite survives', async () => {
    bounce.add('solo-bounce@example.test');
    const res = await post({ email: 'solo-bounce@example.test' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ emailSent: false });
    expect(await pendingRows('solo-bounce@example.test')).toHaveLength(1);
  });

  it('re-inviting the same address replaces the pending invite, as before', async () => {
    const first = (await post({ email: 'legacy-again@example.test' })).json() as { inviteUrl: string };
    const second = (await post({ email: 'legacy-again@example.test' })).json() as { inviteUrl: string };
    expect(second.inviteUrl).not.toBe(first.inviteUrl);
    expect(await pendingRows('legacy-again@example.test')).toHaveLength(1);
  });
});
