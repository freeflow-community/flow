// Phase 16: Google Sign-In + domain self-registration (phase16.md §10).
// DB-backed — runs against a scratch database on the dev postgres (docker
// compose in packages/infra, host port 5442). NATS is not required
// (publishEvent is a no-op without a bus connection).
//
// The Google *token verification* itself is google-auth-library's job and is
// not re-tested here; everything downstream of it runs against
// signInWithGoogleClaims, the seam that takes an already-verified payload.
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';

process.env.DATABASE_URL = process.env.FLOW_TEST_DATABASE_URL
  ?? 'postgres://flow:flow_dev@localhost:5442/flow_google_test';
process.env.FLOW_DATA_KEY = randomBytes(32).toString('base64');
// Most assertions are about the domain rules, not `hd` — the dedicated tests
// below flip this on for themselves.
process.env.FLOW_GOOGLE_REQUIRE_HD = '0';

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
const g = await import('../src/services/oauthGoogle.js');
const { eq, and } = await import('drizzle-orm');
const { emailDomain, isSelfRegisterableDomain } = await import('@flow/shared');

const { users, workspaces, workspaceMembers, channels, channelMembers, oauthIdentities } = schema;

let seq = 0;
/** A verified Google payload, as verifyIdToken would have handed it back. */
function claims(email: string, opts: { sub?: string; name?: string; hd?: string; verified?: boolean } = {}) {
  seq += 1;
  return {
    sub: opts.sub ?? `google-sub-${seq}`,
    email,
    emailVerified: opts.verified ?? true,
    name: opts.name ?? 'Google Person',
    hd: opts.hd,
  };
}

async function registerHuman(email: string, name: string): Promise<string> {
  const res = await auth.register(email, { password: 'password123', displayName: name, autoVerify: true });
  if (!('token' in res)) throw new Error('expected autoVerify session');
  return res.user.id;
}

/** A workspace whose owner holds a Google identity on `domain`, with the
 * self-register toggle already on. Returns the workspace and its owner. */
async function workspaceOpenTo(domain: string): Promise<{ id: string; ownerId: string }> {
  seq += 1;
  const ownerId = await registerHuman(`owner-${seq}@${domain}`, 'Owner');
  await db.insert(oauthIdentities).values({
    provider: 'google',
    providerSubject: `owner-sub-${seq}`,
    userId: ownerId,
    email: `owner-${seq}@${domain}`,
    hostedDomain: domain,
  });
  const created = await ws.createWorkspace(ownerId, `WS ${seq}`, `ws-${seq}-${randomBytes(3).toString('hex')}`);
  await ws.updateWorkspace(created.id, ownerId, { googleSelfRegisterDomain: domain });
  return { id: created.id, ownerId };
}

beforeAll(async () => {
  await migrate();
});

// The scratch database survives between runs and these fixtures use fixed
// addresses/domains, so start each test from an empty slate.
beforeEach(async () => {
  await db.execute(
    `TRUNCATE users, workspaces, sessions, invites, pending_signups, oauth_identities RESTART IDENTITY CASCADE` as never,
  );
});

afterAll(async () => {
  await closeDb();
});

describe('google sign-in', () => {
  it('creates a Flow account on first sight — verified, no usable password', async () => {
    const res = await g.signInWithGoogleClaims(claims('newbie@example.com', { name: 'New Bie' }));
    expect(res.token).toBeTruthy();
    expect(res.user.email).toBe('newbie@example.com');
    expect(res.user.displayName).toBe('New Bie');

    const row = (await db.select().from(users).where(eq(users.id, res.user.id)).limit(1))[0]!;
    expect(row.emailVerifiedAt).not.toBeNull();
    expect(row.passwordHash.startsWith('!google:')).toBe(true);
    // the sentinel can never satisfy a password login
    await expect(auth.login('newbie@example.com', 'password123')).rejects.toThrow();
    // the session is an ordinary session
    expect((await auth.authenticate(res.token)).id).toBe(res.user.id);
  });

  it('rejects an unverified Google email', async () => {
    await expect(
      g.signInWithGoogleClaims(claims('unverified@example.com', { verified: false })),
    ).rejects.toMatchObject({ statusCode: 403, code: 'email_unverified' });
    const rows = await db.select().from(users).where(eq(users.email, 'unverified@example.com'));
    expect(rows).toHaveLength(0);
  });

  it('links an existing password account by verified email instead of duplicating it', async () => {
    const existingId = await registerHuman('both@example.com', 'Both Ways');
    const res = await g.signInWithGoogleClaims(claims('both@example.com'));
    expect(res.user.id).toBe(existingId);
    const all = await db.select().from(users).where(eq(users.email, 'both@example.com'));
    expect(all).toHaveLength(1);
    const ids = await db.select().from(oauthIdentities).where(eq(oauthIdentities.userId, existingId));
    expect(ids).toHaveLength(1);
  });

  it('matches on `sub` before email, so a Google email change keeps the same user', async () => {
    const first = await g.signInWithGoogleClaims(claims('before@example.com', { sub: 'stable-sub' }));
    // Same Google account, new address — and that address belongs to nobody else.
    const second = await g.signInWithGoogleClaims(claims('after@example.com', { sub: 'stable-sub' }));
    expect(second.user.id).toBe(first.user.id);
    const identity = (
      await db.select().from(oauthIdentities).where(eq(oauthIdentities.providerSubject, 'stable-sub'))
    )[0]!;
    expect(identity.email).toBe('after@example.com'); // refreshed on each sign-in
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
    await expect(g.signInWithGoogleClaims(claims('servicebot@example.com'))).rejects.toMatchObject({
      statusCode: 409,
      code: 'email_reserved',
    });
  });

  it('503s when GOOGLE_CLIENT_ID is unset', async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    await expect(g.verifyGoogleIdToken('whatever')).rejects.toMatchObject({
      statusCode: 503,
      code: 'google_disabled',
    });
  });
});

describe('domain self-registration', () => {
  it('enrolls a matching Google user into #general with no invite', async () => {
    const target = await workspaceOpenTo('acme.test');
    const other = await workspaceOpenTo('other.test');

    const res = await g.signInWithGoogleClaims(claims('newhire@acme.test', { hd: 'acme.test' }));
    expect(res.autoJoined.map((w) => w.id)).toEqual([target.id]);

    const member = await db
      .select()
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, target.id), eq(workspaceMembers.userId, res.user.id)));
    expect(member[0]?.role).toBe('member');

    const general = (
      await db
        .select()
        .from(channels)
        .where(and(eq(channels.workspaceId, target.id), eq(channels.name, 'general')))
        .limit(1)
    )[0]!;
    const inGeneral = await db
      .select()
      .from(channelMembers)
      .where(and(eq(channelMembers.channelId, general.id), eq(channelMembers.userId, res.user.id)));
    expect(inGeneral).toHaveLength(1);

    // the non-matching workspace is untouched
    const elsewhere = await db
      .select()
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, other.id), eq(workspaceMembers.userId, res.user.id)));
    expect(elsewhere).toHaveLength(0);
  });

  it('is a no-op on a second sign-in (already a member)', async () => {
    const target = await workspaceOpenTo('repeat.test');
    const first = await g.signInWithGoogleClaims(claims('again@repeat.test', { sub: 'repeat-sub' }));
    expect(first.autoJoined).toHaveLength(1);
    const second = await g.signInWithGoogleClaims(claims('again@repeat.test', { sub: 'repeat-sub' }));
    expect(second.autoJoined).toHaveLength(0);
    const rows = await db
      .select()
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, target.id), eq(workspaceMembers.userId, first.user.id)));
    expect(rows).toHaveLength(1);
  });

  it('never fires for an unverified Google email', async () => {
    await workspaceOpenTo('strict.test');
    await expect(
      g.signInWithGoogleClaims(claims('sneaky@strict.test', { verified: false })),
    ).rejects.toMatchObject({ code: 'email_unverified' });
  });
});

describe('domain helpers (shared with the clients)', () => {
  it('extracts the domain, case-insensitively', () => {
    expect(emailDomain('Person@Acme.COM')).toBe('acme.com');
    expect(emailDomain('plus+tag@sub.acme.com')).toBe('sub.acme.com');
    expect(emailDomain('not-an-email')).toBeNull();
    expect(emailDomain('trailing@')).toBeNull();
  });

  it('denies consumer domains and anything without a dot', () => {
    for (const d of ['gmail.com', 'GMAIL.COM', 'outlook.com', 'yahoo.com', 'icloud.com', 'proton.me']) {
      expect(isSelfRegisterableDomain(d)).toBe(false);
    }
    expect(isSelfRegisterableDomain('localhost')).toBe(false);
    expect(isSelfRegisterableDomain('')).toBe(false);
    expect(isSelfRegisterableDomain('acme.com')).toBe(true);
  });
});

describe('the domain toggle', () => {
  it('rejects consumer domains', async () => {
    const ownerId = await registerHuman('consumer@gmail.com', 'Consumer');
    await db.insert(oauthIdentities).values({
      provider: 'google',
      providerSubject: 'consumer-sub',
      userId: ownerId,
      email: 'consumer@gmail.com',
      hostedDomain: null,
    });
    const created = await ws.createWorkspace(ownerId, 'Consumer WS', `consumer-${randomBytes(3).toString('hex')}`);
    await expect(
      ws.updateWorkspace(created.id, ownerId, { googleSelfRegisterDomain: 'gmail.com' }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'domain_not_allowed' });
  });

  it('rejects a domain that is not the setter’s own verified Google domain', async () => {
    const { id, ownerId } = await workspaceOpenTo('mine.test');
    await expect(
      ws.updateWorkspace(id, ownerId, { googleSelfRegisterDomain: 'notmine.test' }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('rejects a setter with no Google identity at all', async () => {
    const ownerId = await registerHuman('nogoogle@passwords.test', 'No Google');
    const created = await ws.createWorkspace(ownerId, 'Pw WS', `pw-${randomBytes(3).toString('hex')}`);
    await expect(
      ws.updateWorkspace(created.id, ownerId, { googleSelfRegisterDomain: 'passwords.test' }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('is owner/admin only', async () => {
    const { id } = await workspaceOpenTo('authz.test');
    const outsiderId = await registerHuman('outsider@authz.test', 'Outsider');
    await db.insert(oauthIdentities).values({
      provider: 'google',
      providerSubject: 'outsider-sub',
      userId: outsiderId,
      email: 'outsider@authz.test',
      hostedDomain: 'authz.test',
    });
    // not a member at all → 404 (existence isn't leaked)
    await expect(
      ws.updateWorkspace(id, outsiderId, { googleSelfRegisterDomain: 'authz.test' }),
    ).rejects.toMatchObject({ statusCode: 404 });

    // a plain member → 403
    await db.insert(workspaceMembers).values({ workspaceId: id, userId: outsiderId, role: 'member' });
    await expect(
      ws.updateWorkspace(id, outsiderId, { googleSelfRegisterDomain: 'authz.test' }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('turns off with null, and stops enrolling', async () => {
    const { id, ownerId } = await workspaceOpenTo('off.test');
    const updated = await ws.updateWorkspace(id, ownerId, { googleSelfRegisterDomain: null });
    expect(updated.googleSelfRegisterDomain).toBeNull();
    const res = await g.signInWithGoogleClaims(claims('late@off.test'));
    expect(res.autoJoined).toHaveLength(0);
  });

  it('can be set at workspace creation', async () => {
    const ownerId = await registerHuman('founder@startup.test', 'Founder');
    await db.insert(oauthIdentities).values({
      provider: 'google',
      providerSubject: 'founder-sub',
      userId: ownerId,
      email: 'founder@startup.test',
      hostedDomain: 'startup.test',
    });
    const created = await ws.createWorkspace(
      ownerId,
      'Startup',
      `startup-${randomBytes(3).toString('hex')}`,
      'startup.test',
    );
    expect(created.googleSelfRegisterDomain).toBe('startup.test');
    const stored = (await db.select().from(workspaces).where(eq(workspaces.id, created.id)).limit(1))[0]!;
    expect(stored.googleSelfRegisterDomain).toBe('startup.test');
  });

  describe('with `hd` hardening on (the default)', () => {
    it('requires the setter’s account to be a Google Workspace account on the domain', async () => {
      const ownerId = await registerHuman('solo@custom.test', 'Solo');
      // a personal Gmail-backed account that merely *spells* a corporate address
      await db.insert(oauthIdentities).values({
        provider: 'google',
        providerSubject: 'solo-sub',
        userId: ownerId,
        email: 'solo@custom.test',
        hostedDomain: null,
      });
      const created = await ws.createWorkspace(ownerId, 'Custom', `custom-${randomBytes(3).toString('hex')}`);
      process.env.FLOW_GOOGLE_REQUIRE_HD = '1';
      try {
        await expect(
          ws.updateWorkspace(created.id, ownerId, { googleSelfRegisterDomain: 'custom.test' }),
        ).rejects.toMatchObject({ statusCode: 403 });
      } finally {
        process.env.FLOW_GOOGLE_REQUIRE_HD = '0';
      }
      // with the escape hatch, the same call goes through
      const ok = await ws.updateWorkspace(created.id, ownerId, { googleSelfRegisterDomain: 'custom.test' });
      expect(ok.googleSelfRegisterDomain).toBe('custom.test');
    });
  });
});
