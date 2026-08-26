// Mini apps, step 1 — server (docs/design/MINI_APPS.md, issue #369): registering
// a link artifact as an app, the per-artifact secret (returned once, encrypted
// at rest, never in a read), minting 5-minute member identity tokens, and
// rotation as the revocation lever. DB-backed — scratch database on the dev
// postgres (docker compose in packages/infra, host port 5442).
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATABASE_URL = process.env.FLOW_TEST_DATABASE_URL
  ?? 'postgres://flow:flow_dev@localhost:5442/flow_miniapps_test';
process.env.FLOW_DATA_KEY = randomBytes(32).toString('base64');
process.env.FLOW_FILE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-miniapps-test-'));
delete process.env.FLOW_BLOB_DRIVER;

{
  const { default: postgres } = await import('postgres');
  const url = new URL(process.env.DATABASE_URL);
  const dbName = url.pathname.slice(1);
  url.pathname = '/postgres';
  const admin = postgres(url.toString(), { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE "${dbName}"`).catch(() => {}); // 42P04 duplicate_database
  await admin.end();
}

const { migrate } = await import('../src/db/migrate.js');
const { db, schema, closeDb } = await import('../src/db/index.js');
const auth = await import('../src/services/auth.js');
const ws = await import('../src/services/workspaces.js');
const ch = await import('../src/services/channels.js');
const ar = await import('../src/services/artifacts.js');
const { verifyAppToken, APP_TOKEN_TTL_SECONDS } = await import('../src/lib/appToken.js');
const { CreateArtifactBody } = await import('@flow/shared');
const { eq } = await import('drizzle-orm');

const { artifacts, users, workspaceMembers } = schema;

let aliceId = ''; // workspace owner
let bobId = ''; // channel member, plain member
let agentId = ''; // channel member, isAgent
let adminId = ''; // workspace admin, channel member
let lonerId = ''; // workspace member, NOT in the channel
let workspaceId = '';
let channelId = '';

async function registerHuman(email: string, name: string): Promise<string> {
  const res = await auth.register(email, { password: 'password123', displayName: name, autoVerify: true });
  if (!('token' in res)) throw new Error('expected autoVerify session');
  return res.user.id;
}

/** Register a fresh app on a URL nobody has pinned yet, returning the DTO with
 * its one-time secret. */
async function newApp(userId = aliceId, url = `https://app-${randomUUID().slice(0, 8)}.example.com/`) {
  const dto = await ar.createArtifact(userId, channelId, { url, app: true });
  if (!('appSecret' in dto)) throw new Error('expected a secret on an app create');
  return dto;
}

beforeAll(async () => {
  await migrate(process.env.DATABASE_URL!);
  await db.execute(`TRUNCATE users, workspaces, sessions, invites, pending_signups RESTART IDENTITY CASCADE` as never);
  aliceId = await registerHuman('alice@example.test', 'Alice');
  bobId = await registerHuman('bob@example.test', 'Bob');
  agentId = await registerHuman('robo@example.test', 'Robo');
  adminId = await registerHuman('admin@example.test', 'Ada');
  lonerId = await registerHuman('loner@example.test', 'Loner');
  await db.update(users).set({ isAgent: true }).where(eq(users.id, agentId));

  const w = await ws.createWorkspace(aliceId, 'Mini Apps Test', `miniapps-${randomUUID().slice(0, 8)}`);
  workspaceId = w.id;
  for (const uid of [bobId, agentId, lonerId]) {
    await db.insert(workspaceMembers).values({ workspaceId, userId: uid, role: 'member' });
  }
  await db.insert(workspaceMembers).values({ workspaceId, userId: adminId, role: 'admin' });

  const chan = await ch.createChannel(workspaceId, aliceId, 'apps');
  channelId = chan.id;
  for (const uid of [bobId, agentId, adminId]) await ch.addMember(channelId, aliceId, uid);
});

afterAll(async () => {
  await closeDb();
  fs.rmSync(process.env.FLOW_FILE_DIR!, { recursive: true, force: true });
});

describe('registering an app', () => {
  it('rejects app:true without a url — schema and service', () => {
    const parsed = CreateArtifactBody.safeParse({ channelId, fileId: randomUUID(), app: true });
    expect(parsed.success).toBe(false);
    return expect(ar.createArtifact(aliceId, channelId, { fileId: randomUUID(), app: true })).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('returns the secret once and marks the artifact isApp', async () => {
    const app = await newApp();
    expect(app.kind).toBe('link');
    expect(app.isApp).toBe(true);
    // 32 random bytes, base64url
    expect(Buffer.from(app.appSecret, 'base64url')).toHaveLength(32);
  });

  it('a plain link pin is not an app', async () => {
    const plain = await ar.createArtifact(aliceId, channelId, { url: 'https://plain.example.com/' });
    expect(plain.isApp).toBe(false);
    expect('appSecret' in plain).toBe(false);
  });

  it('never leaks the secret through a read path', async () => {
    const app = await newApp();
    const listed = (await ar.listArtifacts(workspaceId, aliceId)).find((a) => a.id === app.id)!;
    expect(listed.isApp).toBe(true);
    expect(JSON.stringify(listed)).not.toContain(app.appSecret);
    const renamed = await ar.renameArtifact(app.id, aliceId, 'Task Board');
    expect(JSON.stringify(renamed)).not.toContain(app.appSecret);
  });

  it('stores the secret encrypted at rest', async () => {
    const app = await newApp();
    const row = (await db.select().from(artifacts).where(eq(artifacts.id, app.id)).limit(1))[0]!;
    const raw = Buffer.from(app.appSecret, 'base64url');
    expect(row.appSecret).not.toBeNull();
    expect(row.appSecret!.includes(raw)).toBe(false); // ciphertext, not the secret
    expect(row.appSecretNonce).not.toBeNull();
    expect(row.appEncKeyId).toBeTruthy();
    expect(row.appEncScheme).toBe(1); // AES-256-GCM
  });

  it('promotes an existing plain pin, then refuses to re-register it', async () => {
    const url = `https://promote-${randomUUID().slice(0, 8)}.example.com/`;
    const plain = await ar.createArtifact(aliceId, channelId, { url });
    expect(plain.isApp).toBe(false);
    const promoted = await ar.createArtifact(aliceId, channelId, { url, app: true });
    expect(promoted.id).toBe(plain.id);
    expect(promoted.isApp).toBe(true);
    expect('appSecret' in promoted).toBe(true);
    // already an app: a second create can't hand back a secret, and silently
    // rotating would kill live tokens — 409, rotate explicitly instead
    await expect(ar.createArtifact(aliceId, channelId, { url, app: true })).rejects.toMatchObject({
      statusCode: 409,
      code: 'app_exists',
    });
  });

  it('rejects a non-member of the channel', async () => {
    await expect(
      ar.createArtifact(lonerId, channelId, { url: 'https://nope.example.com/', app: true }),
    ).rejects.toThrow(/join the channel/);
  });
});

describe('minting a token', () => {
  it('mints a token that verifies against the documented HMAC format', async () => {
    const app = await newApp();
    const { token, expiresAt } = await ar.mintArtifactAppToken(app.id, bobId);
    const secret = Buffer.from(app.appSecret, 'base64url');

    // verify the way the guard will — by hand, not through our own helper
    const [payloadB64, macB64] = token.split('.');
    const json = Buffer.from(payloadB64!, 'base64url');
    const expected = createHmac('sha256', secret).update(json).digest('base64url');
    expect(macB64).toBe(expected);

    const payload = JSON.parse(json.toString('utf8'));
    expect(payload).toMatchObject({
      v: 1,
      artifactId: app.id,
      channelId,
      workspaceId,
      userId: bobId,
      displayName: 'Bob',
      isAgent: false,
    });
    expect(typeof payload.jti).toBe('string');
    expect(payload.jti.length).toBeGreaterThan(10);
    expect(payload.exp - payload.iat).toBe(APP_TOKEN_TTL_SECONDS); // 300s
    expect(new Date(expiresAt).getTime()).toBe(payload.exp * 1000);
    expect(verifyAppToken(secret, token)).toMatchObject({ userId: bobId });
  });

  it('carries isAgent for agent callers, and a fresh jti each mint', async () => {
    const app = await newApp();
    const secret = Buffer.from(app.appSecret, 'base64url');
    const one = await ar.mintArtifactAppToken(app.id, agentId);
    const two = await ar.mintArtifactAppToken(app.id, agentId);
    const p1 = verifyAppToken(secret, one.token)!;
    const p2 = verifyAppToken(secret, two.token)!;
    expect(p1.isAgent).toBe(true);
    expect(p1.jti).not.toBe(p2.jti); // single-use: the guard burns them
  });

  it('expires after 300 seconds', async () => {
    const app = await newApp();
    const secret = Buffer.from(app.appSecret, 'base64url');
    const { token } = await ar.mintArtifactAppToken(app.id, bobId);
    const later = new Date(Date.now() + (APP_TOKEN_TTL_SECONDS + 1) * 1000);
    expect(verifyAppToken(secret, token, later)).toBeNull();
    expect(verifyAppToken(secret, token, new Date(Date.now() + 299_000))).not.toBeNull();
  });

  it('rejects a non-member — the same gate as every other artifact op', async () => {
    const app = await newApp();
    await expect(ar.mintArtifactAppToken(app.id, lonerId)).rejects.toThrow(/join the channel/);
  });

  it('rejects a tampered payload and a token from another app', async () => {
    const app = await newApp();
    const other = await newApp();
    const secret = Buffer.from(app.appSecret, 'base64url');
    const { token } = await ar.mintArtifactAppToken(app.id, bobId);

    const [payloadB64, mac] = token.split('.');
    const payload = JSON.parse(Buffer.from(payloadB64!, 'base64url').toString('utf8'));
    payload.userId = aliceId;
    const forged = `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${mac}`;
    expect(verifyAppToken(secret, forged)).toBeNull();

    const otherToken = (await ar.mintArtifactAppToken(other.id, bobId)).token;
    expect(verifyAppToken(secret, otherToken)).toBeNull(); // per-artifact secrets
    expect(verifyAppToken(secret, 'not-a-token')).toBeNull();
  });

  it('404s an unknown artifact and 400s a plain link', async () => {
    const plain = await ar.createArtifact(aliceId, channelId, { url: 'https://notanapp.example.com/' });
    await expect(ar.mintArtifactAppToken(plain.id, bobId)).rejects.toMatchObject({ statusCode: 400, code: 'not_an_app' });
    await expect(ar.mintArtifactAppToken(randomUUID(), bobId)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('rotating the secret', () => {
  it('invalidates tokens minted under the old secret', async () => {
    const app = await newApp();
    const oldSecret = Buffer.from(app.appSecret, 'base64url');
    const { token } = await ar.mintArtifactAppToken(app.id, bobId);
    expect(verifyAppToken(oldSecret, token)).not.toBeNull();

    const rotated = await ar.rotateArtifactAppSecret(app.id, aliceId);
    const newSecret = Buffer.from(rotated.appSecret, 'base64url');
    expect(rotated.appSecret).not.toBe(app.appSecret);
    expect(rotated.isApp).toBe(true);

    expect(verifyAppToken(newSecret, token)).toBeNull(); // the old token is dead
    const fresh = await ar.mintArtifactAppToken(app.id, bobId);
    expect(verifyAppToken(newSecret, fresh.token)).not.toBeNull();
    expect(verifyAppToken(oldSecret, fresh.token)).toBeNull();
  });

  it('lets a workspace admin rotate, but not a plain member', async () => {
    const app = await newApp();
    await expect(ar.rotateArtifactAppSecret(app.id, bobId)).rejects.toMatchObject({ statusCode: 403 });
    const rotated = await ar.rotateArtifactAppSecret(app.id, adminId);
    expect(Buffer.from(rotated.appSecret, 'base64url')).toHaveLength(32);
  });

  it('lets the creator rotate even without workspace admin', async () => {
    const app = await newApp(bobId);
    const rotated = await ar.rotateArtifactAppSecret(app.id, bobId);
    expect(rotated.appSecret).not.toBe(app.appSecret);
  });

  it('rejects a non-member and a plain link', async () => {
    const app = await newApp();
    await expect(ar.rotateArtifactAppSecret(app.id, lonerId)).rejects.toThrow(/join the channel/);
    const plain = await ar.createArtifact(aliceId, channelId, { url: 'https://plain2.example.com/' });
    await expect(ar.rotateArtifactAppSecret(plain.id, aliceId)).rejects.toMatchObject({ code: 'not_an_app' });
  });
});
