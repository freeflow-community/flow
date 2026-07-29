// Sign in with Apple — the account matching / creation / self-registration
// behind an already-verified identity token. DB-backed, same harness as
// googleAuth.test.ts. The Apple *token verification* itself is jose's job and
// is not re-tested here; everything downstream of it runs against
// signInWithAppleClaims, the seam that takes an already-verified payload.
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';

process.env.DATABASE_URL = process.env.FLOW_TEST_DATABASE_URL
  ?? 'postgres://flow:flow_dev@localhost:5442/flow_apple_test';
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
const a = await import('../src/services/oauthApple.js');
const { listIdentities } = await import('../src/services/oauthAccounts.js');
const { eq } = await import('drizzle-orm');

const { users, workspaceMembers, oauthIdentities } = schema;

let seq = 0;
/** A verified Apple payload, as verifyAppleIdentityToken would have handed it back. */
function claims(email: string, opts: { sub?: string; name?: string; verified?: boolean } = {}) {
  seq += 1;
  return {
    sub: opts.sub ?? `apple-sub-${seq}`,
    email,
    emailVerified: opts.verified ?? true,
    name: opts.name,
  };
}

async function registerHuman(email: string, name: string): Promise<string> {
  const res = await auth.register(email, { password: 'password123', displayName: name, autoVerify: true });
  if (!('token' in res)) throw new Error('expected autoVerify session');
  return res.user.id;
}

beforeAll(async () => {
  await migrate();
});

beforeEach(async () => {
  await db.execute(
    `TRUNCATE users, workspaces, sessions, invites, pending_signups, oauth_identities RESTART IDENTITY CASCADE` as never,
  );
});

afterAll(async () => {
  await closeDb();
});

describe('apple sign-in', () => {
  it('creates a Flow account on first sight — verified, no usable password', async () => {
    const res = await a.signInWithAppleClaims(claims('newbie@example.com', { name: 'New Bie' }));
    expect(res.token).toBeTruthy();
    expect(res.user.email).toBe('newbie@example.com');
    expect(res.user.displayName).toBe('New Bie');

    const row = (await db.select().from(users).where(eq(users.id, res.user.id)).limit(1))[0]!;
    expect(row.emailVerifiedAt).not.toBeNull();
    expect(row.passwordHash.startsWith('!apple:')).toBe(true);
    // the sentinel can never satisfy a password login
    await expect(auth.login('newbie@example.com', 'password123')).rejects.toThrow();
    // the session is an ordinary session
    expect((await auth.authenticate(res.token)).id).toBe(res.user.id);
  });

  it('falls back to the email local part when no name was forwarded', async () => {
    const res = await a.signInWithAppleClaims(claims('quiet@example.com'));
    expect(res.user.displayName).toBe('quiet');
  });

  it('handles a private-relay address like any other verified email', async () => {
    const res = await a.signInWithAppleClaims(claims('abc123xyz@privaterelay.appleid.com', { name: 'Private Person' }));
    expect(res.user.email).toBe('abc123xyz@privaterelay.appleid.com');
    // relay domains are nobody's org domain, so no workspace auto-enrolls
    expect(res.autoJoined).toHaveLength(0);
  });

  it('rejects an unverified Apple email', async () => {
    await expect(
      a.signInWithAppleClaims(claims('unverified@example.com', { verified: false })),
    ).rejects.toMatchObject({ statusCode: 403, code: 'email_unverified' });
    const rows = await db.select().from(users).where(eq(users.email, 'unverified@example.com'));
    expect(rows).toHaveLength(0);
  });

  it('links an existing password account by verified email instead of duplicating it', async () => {
    const existingId = await registerHuman('both@example.com', 'Both Ways');
    const res = await a.signInWithAppleClaims(claims('both@example.com'));
    expect(res.user.id).toBe(existingId);
    const all = await db.select().from(users).where(eq(users.email, 'both@example.com'));
    expect(all).toHaveLength(1);
    const ids = await listIdentities(existingId);
    expect(ids).toHaveLength(1);
    expect(ids[0]!.provider).toBe('apple');
  });

  it('matches on `sub` before email, so an Apple email change keeps the same user', async () => {
    const first = await a.signInWithAppleClaims(claims('before@example.com', { sub: 'stable-sub' }));
    const second = await a.signInWithAppleClaims(claims('after@example.com', { sub: 'stable-sub' }));
    expect(second.user.id).toBe(first.user.id);
    const identity = (
      await db.select().from(oauthIdentities).where(eq(oauthIdentities.providerSubject, 'stable-sub'))
    )[0]!;
    expect(identity.email).toBe('after@example.com'); // refreshed on each sign-in
    expect(identity.provider).toBe('apple');
  });

  it('coexists with a Google identity on the same account (one user, two providers)', async () => {
    const userId = await registerHuman('multi@example.com', 'Multi Provider');
    await db.insert(oauthIdentities).values({
      provider: 'google',
      providerSubject: 'google-multi-sub',
      userId,
      email: 'multi@example.com',
      hostedDomain: null,
    });
    const res = await a.signInWithAppleClaims(claims('multi@example.com'));
    expect(res.user.id).toBe(userId);
    const ids = await listIdentities(userId);
    expect(ids.map((i) => i.provider).sort()).toEqual(['apple', 'google']);
  });

  it('refuses to merge into a bot or agent account', async () => {
    const id = crypto.randomUUID();
    await db.insert(users).values({
      id,
      email: 'servicebot@example.com',
      passwordHash: '!bot:x',
      displayName: 'Service Bot',
      isBot: true,
      emailVerifiedAt: new Date(),
    });
    await expect(a.signInWithAppleClaims(claims('servicebot@example.com'))).rejects.toMatchObject({
      statusCode: 409,
      code: 'email_reserved',
    });
  });

  it('enrolls a matching user into an open workspace, like the Google flow', async () => {
    const ownerId = await registerHuman('owner@acme.test', 'Owner');
    await db.insert(oauthIdentities).values({
      provider: 'google',
      providerSubject: 'owner-sub',
      userId: ownerId,
      email: 'owner@acme.test',
      hostedDomain: 'acme.test',
    });
    const created = await ws.createWorkspace(ownerId, 'Acme', `acme-${randomBytes(3).toString('hex')}`);
    await ws.updateWorkspace(created.id, ownerId, { googleSelfRegisterDomain: 'acme.test' });

    const res = await a.signInWithAppleClaims(claims('newhire@acme.test'));
    expect(res.autoJoined.map((w) => w.id)).toEqual([created.id]);
    const member = await db
      .select()
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, res.user.id));
    expect(member.some((m) => m.workspaceId === created.id && m.role === 'member')).toBe(true);
  });

  it('503s when APPLE_BUNDLE_ID is unset', async () => {
    delete process.env.APPLE_BUNDLE_ID;
    await expect(a.verifyAppleIdentityToken('whatever')).rejects.toMatchObject({
      statusCode: 503,
      code: 'apple_disabled',
    });
  });
});
