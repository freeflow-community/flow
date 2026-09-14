// Workspace avatar (#336): the optional image mark an owner/admin can set for a
// workspace. It reuses the *user* avatar pipeline — square-cropped webp under
// the `avatars/` blob prefix, referenced by a `/v1/avatars/<key>` path on the
// DTO — so what's worth testing is the guard rails around it (who may set it,
// what bytes are accepted) and that clearing really returns the workspace to
// the no-avatar state old rows have always been in.
//
// DB-backed — scratch database on the dev postgres (docker compose in
// packages/infra, host port 5442). Local blob driver, so the stored bytes can
// be read back off disk.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

process.env.DATABASE_URL = process.env.FLOW_TEST_DATABASE_URL
  ?? 'postgres://flow:flow_dev@localhost:5442/flow_workspace_avatar_test';
process.env.FLOW_DATA_KEY = randomBytes(32).toString('base64');
process.env.FLOW_FILE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-ws-avatar-test-'));
delete process.env.FLOW_BLOB_DRIVER; // force the local driver regardless of shell env

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
const { blobStore } = await import('../src/storage/index.js');

let aliceId = ''; // workspace owner
let bobId = ''; // plain member
let workspaceId = '';
let png = Buffer.alloc(0);

async function registerHuman(email: string, name: string): Promise<string> {
  const res = await auth.register(email, { password: 'password123', displayName: name, autoVerify: true });
  if (!('token' in res)) throw new Error('expected autoVerify session');
  return res.user.id;
}

beforeAll(async () => {
  await migrate(process.env.DATABASE_URL!);
  await db.execute(`TRUNCATE users, workspaces, sessions, invites, pending_signups RESTART IDENTITY CASCADE` as never);
  aliceId = await registerHuman('alice@example.test', 'Alice');
  bobId = await registerHuman('bob@example.test', 'Bob');

  const w = await ws.createWorkspace(aliceId, 'Avatar Test', `avatar-${randomUUID().slice(0, 8)}`);
  workspaceId = w.id;
  await db.insert(schema.workspaceMembers).values({ workspaceId, userId: bobId, role: 'member' });

  // a real (oblong) image, so the square-crop is actually exercised
  png = await sharp({
    create: { width: 200, height: 120, channels: 3, background: { r: 220, g: 40, b: 120 } },
  })
    .png()
    .toBuffer();
});

afterAll(async () => {
  await closeDb();
});

describe('a workspace with no avatar', () => {
  it('carries a null avatarUrl on the DTO — unchanged rendering for old workspaces', async () => {
    const dto = await ws.getWorkspace(workspaceId, bobId);
    expect(dto.avatarUrl).toBeNull();
  });
});

describe('setting one', () => {
  it('stores a square webp and exposes it as an /v1/avatars path', async () => {
    const dto = await ws.setWorkspaceAvatar(workspaceId, aliceId, png, 'image/png');
    expect(dto.avatarUrl).toMatch(/^\/v1\/avatars\/[0-9a-f-]{36}-\d+\.webp$/);
    expect(dto.role).toBe('owner'); // the setter still gets their role back

    // the blob is fetchable through the same route user avatars use
    const key = dto.avatarUrl!.slice('/v1/avatars/'.length);
    const stored = await us.getAvatar(key);
    const meta = await sharp(stored).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(meta.height); // square-cropped
  });

  it('is visible to every member and survives a fresh fetch', async () => {
    const asBob = await ws.getWorkspace(workspaceId, bobId);
    expect(asBob.avatarUrl).toMatch(/^\/v1\/avatars\//);
    const listed = (await ws.myWorkspaces(bobId)).find((w) => w.id === workspaceId);
    expect(listed?.avatarUrl).toBe(asBob.avatarUrl);
  });

  it('drops the blob it replaced', async () => {
    const first = (await ws.getWorkspace(workspaceId, aliceId)).avatarUrl!;
    // the key embeds Date.now(), so a same-millisecond replace would reuse it
    await new Promise((r) => setTimeout(r, 2));
    const second = (await ws.setWorkspaceAvatar(workspaceId, aliceId, png, 'image/png')).avatarUrl!;
    expect(second).not.toBe(first);
    await expect(blobStore().get(`avatars/${first.slice('/v1/avatars/'.length)}`)).rejects.toThrow();
  });
});

describe('guard rails', () => {
  it('refuses a non-image mime type', async () => {
    await expect(ws.setWorkspaceAvatar(workspaceId, aliceId, png, 'application/pdf')).rejects.toMatchObject({
      statusCode: 400,
      code: 'bad_image',
    });
  });

  it('refuses bytes that are not a decodable image', async () => {
    await expect(
      ws.setWorkspaceAvatar(workspaceId, aliceId, Buffer.from('not an image'), 'image/png'),
    ).rejects.toMatchObject({ statusCode: 400, code: 'bad_image' });
  });

  it('refuses anything over the 1MB cap', async () => {
    const fat = Buffer.alloc(1024 * 1024 + 1);
    png.copy(fat); // a valid header on an over-cap buffer — size is checked first
    await expect(ws.setWorkspaceAvatar(workspaceId, aliceId, fat, 'image/png')).rejects.toMatchObject({
      statusCode: 400,
      code: 'file_too_large',
    });
  });

  it('forbids a plain member from setting or clearing', async () => {
    await expect(ws.setWorkspaceAvatar(workspaceId, bobId, png, 'image/png')).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(ws.clearWorkspaceAvatar(workspaceId, bobId)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('hides the workspace from a non-member entirely', async () => {
    const outsiderId = await registerHuman('carol@example.test', 'Carol');
    await expect(ws.setWorkspaceAvatar(workspaceId, outsiderId, png, 'image/png')).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe('removing it', () => {
  it('returns the workspace to the color/initial mark and deletes the blob', async () => {
    const before = (await ws.getWorkspace(workspaceId, aliceId)).avatarUrl!;
    const dto = await ws.clearWorkspaceAvatar(workspaceId, aliceId);
    expect(dto.avatarUrl).toBeNull();
    expect((await ws.getWorkspace(workspaceId, bobId)).avatarUrl).toBeNull();
    await expect(blobStore().get(`avatars/${before.slice('/v1/avatars/'.length)}`)).rejects.toThrow();
  });
});
