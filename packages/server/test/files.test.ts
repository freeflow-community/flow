// Files: presigned direct-upload lifecycle (R2 era), plaintext blobs, legacy
// encrypted reads, orphan sweep. DB-backed — runs against a scratch database on
// the dev postgres (docker compose in packages/infra, host port 5442). Uses the
// local blob driver, whose presignPut returns null → the service hands out the
// server-proxied /v1/files/:id/content fallback, exercising the same
// pending→ready state machine the R2 path uses.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

process.env.DATABASE_URL = process.env.FLOW_TEST_DATABASE_URL
  ?? 'postgres://flow:flow_dev@localhost:5442/flow_files_test';
process.env.FLOW_DATA_KEY = randomBytes(32).toString('base64');
process.env.FLOW_FILE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-files-test-'));
delete process.env.FLOW_BLOB_DRIVER; // force the local driver regardless of shell env

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
const { config } = await import('../src/config.js');
const { migrate } = await import('../src/db/migrate.js');
const { db, schema, closeDb } = await import('../src/db/index.js');
const auth = await import('../src/services/auth.js');
const ws = await import('../src/services/workspaces.js');
const fl = await import('../src/services/files.js');
const { encryptBlob } = await import('../src/crypto/index.js');
const { blobStore } = await import('../src/storage/index.js');
const { newId } = await import('../src/lib/ids.js');
const { eq } = await import('drizzle-orm');

const { files, workspaceMembers } = schema;

let uploaderId = '';
let outsiderId = '';
let workspaceId = '';

async function registerHuman(email: string, name: string): Promise<{ id: string; token: string }> {
  const res = await auth.register(email, { password: 'password123', displayName: name, autoVerify: true });
  if (!('token' in res)) throw new Error('expected autoVerify session');
  return { id: res.user.id, token: res.token };
}

beforeAll(async () => {
  await migrate(process.env.DATABASE_URL!);
  await db.execute(`TRUNCATE users, workspaces, sessions, invites, pending_signups RESTART IDENTITY CASCADE` as never);
  const uploader = await registerHuman('uploader@example.test', 'Uploader');
  uploaderId = uploader.id;
  const outsider = await registerHuman('outsider@example.test', 'Outsider');
  outsiderId = outsider.id;
  const wsDto = await ws.createWorkspace(uploaderId, 'Files Test WS', `files-${Date.now()}`);
  workspaceId = wsDto.id;
});

afterAll(async () => {
  await closeDb();
  fs.rmSync(process.env.FLOW_FILE_DIR!, { recursive: true, force: true });
});

const png = (): Promise<Buffer> =>
  sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 90, g: 60, b: 200 } } })
    .png()
    .toBuffer();

describe('presigned upload lifecycle (local fallback)', () => {
  it('presign → PUT bytes → complete: pending row becomes ready with thumbnail', async () => {
    const data = await png();
    const pres = await fl.createPresignedUpload(workspaceId, uploaderId, 'pic.png', 'image/png', data.length);
    expect(pres.upload.url).toBe(`/v1/files/${pres.file.id}/content`); // local driver can't presign
    expect(pres.upload.method).toBe('PUT');

    // not attachable and not downloadable while pending
    await expect(fl.validateAttachments([pres.file.id], workspaceId, uploaderId)).rejects.toMatchObject({
      code: 'bad_file',
    });
    await expect(fl.getFileDownload(pres.file.id, uploaderId)).rejects.toMatchObject({ statusCode: 404 });

    await fl.putPendingContent(pres.file.id, uploaderId, data);
    const done = await fl.completeUpload(pres.file.id, uploaderId);
    expect(done.hasThumb).toBe(true);
    expect(done.width).toBe(800);
    expect(done.height).toBe(600);

    // now downloadable (proxied on the local driver) and attachable
    const dl = await fl.getFileDownload(pres.file.id, uploaderId);
    if (!('content' in dl)) throw new Error('expected proxied content on local driver');
    expect(dl.content.data.equals(data)).toBe(true);
    expect(dl.content.mimeType).toBe('image/png');
    const rows = await fl.validateAttachments([pres.file.id], workspaceId, uploaderId);
    expect(rows).toHaveLength(1);

    // complete is idempotent
    const again = await fl.completeUpload(pres.file.id, uploaderId);
    expect(again.id).toBe(done.id);
  });

  it('binds the declared size: wrong-length PUT and short uploads are rejected', async () => {
    const pres = await fl.createPresignedUpload(workspaceId, uploaderId, 'doc.txt', 'text/plain', 10);
    await expect(fl.putPendingContent(pres.file.id, uploaderId, Buffer.from('way more than ten bytes'))).rejects.toMatchObject(
      { code: 'size_mismatch' },
    );
    // nothing uploaded → complete refuses
    await expect(fl.completeUpload(pres.file.id, uploaderId)).rejects.toMatchObject({ code: 'upload_incomplete' });
  });

  it('rejects zero/oversized declarations and non-members', async () => {
    await expect(fl.createPresignedUpload(workspaceId, uploaderId, 'x', 'text/plain', 0)).rejects.toMatchObject({
      code: 'empty_file',
    });
    await expect(
      fl.createPresignedUpload(workspaceId, uploaderId, 'x', 'text/plain', config.maxFileBytes + 1),
    ).rejects.toMatchObject({ code: 'file_too_large' });
    // direct path accepts what multipart can't: video-scale sizes are declarable
    const big = await fl.createPresignedUpload(workspaceId, uploaderId, 'movie.mp4', 'video/mp4', 200 * 1024 * 1024);
    expect(big.file.sizeBytes).toBe(200 * 1024 * 1024);
    await expect(
      fl.createPresignedUpload(workspaceId, outsiderId, 'x', 'text/plain', 10),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('multipart (server-buffered) path keeps the small cap', async () => {
    const oversize = Buffer.alloc(config.maxServerUploadBytes + 1);
    await expect(fl.uploadFile(workspaceId, uploaderId, 'big.bin', 'application/octet-stream', oversize)).rejects.toMatchObject(
      { code: 'file_too_large' },
    );
  });

  it('skips thumbnail generation for images above the sidecar cap', async () => {
    const size = config.thumbSourceMaxBytes + 1;
    const pres = await fl.createPresignedUpload(workspaceId, uploaderId, 'huge.png', 'image/png', size);
    await fl.putPendingContent(pres.file.id, uploaderId, Buffer.alloc(size));
    const done = await fl.completeUpload(pres.file.id, uploaderId);
    expect(done.hasThumb).toBe(false);
    expect(done.width).toBeNull();
  });

  it('stream URL is null on the local driver (client falls back to proxy fetch)', async () => {
    const data = Buffer.from('vid');
    const pres = await fl.createPresignedUpload(workspaceId, uploaderId, 'clip.mp4', 'video/mp4', data.length);
    await fl.putPendingContent(pres.file.id, uploaderId, data);
    await fl.completeUpload(pres.file.id, uploaderId);
    const stream = await fl.getStreamUrl(pres.file.id, uploaderId);
    expect(stream.url).toBeNull();
  });

  it('only the uploader can PUT/complete a pending file', async () => {
    const pres = await fl.createPresignedUpload(workspaceId, uploaderId, 'p.txt', 'text/plain', 5);
    await db.insert(workspaceMembers).values({ workspaceId, userId: outsiderId, role: 'member' });
    await expect(fl.putPendingContent(pres.file.id, outsiderId, Buffer.from('12345'))).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(fl.completeUpload(pres.file.id, outsiderId)).rejects.toMatchObject({ statusCode: 404 });
    await db.delete(workspaceMembers).where(eq(workspaceMembers.userId, outsiderId));
  });
});

describe('multipart upload (legacy path) writes plaintext', () => {
  it('stores the exact bytes on disk, no envelope', async () => {
    const data = Buffer.from('plain and simple');
    const dto = await fl.uploadFile(workspaceId, uploaderId, 'note.txt', 'text/plain', data);
    const raw = await blobStore().get(`files/${dto.id}`);
    expect(raw.equals(data)).toBe(true); // plaintext on the blob store
    const row = await db.select().from(files).where(eq(files.id, dto.id));
    expect(row[0]!.encKeyId).toBeNull();
    expect(row[0]!.status).toBe('ready');
  });
});

describe('legacy encrypted rows', () => {
  it('still decrypt through the keyring on download', async () => {
    const data = Buffer.from('secret legacy bytes');
    const enc = encryptBlob(data);
    const id = newId();
    await blobStore().put(`files/${id}`, enc.blob);
    await db.insert(files).values({
      id,
      workspaceId,
      userId: uploaderId,
      name: 'legacy.bin',
      mimeType: 'application/octet-stream',
      sizeBytes: data.length,
      storageKey: `files/${id}`,
      encKeyId: enc.encKeyId,
    });
    const dl = await fl.getFileDownload(id, uploaderId);
    if (!('content' in dl)) throw new Error('expected proxied content');
    expect(dl.content.data.equals(data)).toBe(true);
  });
});

describe('orphan sweep', () => {
  it('reaps stale pending uploads and their blobs', async () => {
    const pres = await fl.createPresignedUpload(workspaceId, uploaderId, 'stale.txt', 'text/plain', 5);
    await fl.putPendingContent(pres.file.id, uploaderId, Buffer.from('12345'));
    // age the row past the TTL
    await db
      .update(files)
      .set({ createdAt: new Date(Date.now() - 25 * 3600_000) })
      .where(eq(files.id, pres.file.id));
    const swept = await fl.sweepOrphanFiles();
    expect(swept).toBeGreaterThanOrEqual(1);
    const rows = await db.select().from(files).where(eq(files.id, pres.file.id));
    expect(rows).toHaveLength(0);
    await expect(blobStore().get(`files/${pres.file.id}`)).rejects.toThrow();
  });
});
