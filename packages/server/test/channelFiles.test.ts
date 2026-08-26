// Channel Files panel (#347): GET /v1/channels/:id/files — the four sort
// orders, cursor paging, membership, and the deleted-message exclusion.
// DB-backed, same scratch-database pattern as files.test.ts.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATABASE_URL = process.env.FLOW_TEST_DATABASE_URL
  ?? 'postgres://flow:flow_dev@localhost:5442/flow_channel_files_test';
process.env.FLOW_DATA_KEY = randomBytes(32).toString('base64');
process.env.FLOW_FILE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-chanfiles-test-'));
delete process.env.FLOW_BLOB_DRIVER;

{
  const { default: postgres } = await import('postgres');
  const url = new URL(process.env.DATABASE_URL);
  const dbName = url.pathname.slice(1);
  url.pathname = '/postgres';
  const admin = postgres(url.toString(), { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE "${dbName}"`).catch(() => {});
  await admin.end();
}

const { migrate } = await import('../src/db/migrate.js');
const { db, schema, closeDb } = await import('../src/db/index.js');
const auth = await import('../src/services/auth.js');
const ws = await import('../src/services/workspaces.js');
const ch = await import('../src/services/channels.js');
const msg = await import('../src/services/messages.js');
const fl = await import('../src/services/files.js');
const { newId } = await import('../src/lib/ids.js');

let ownerId = '';
let matesId = '';
let outsiderId = '';
let workspaceId = '';
let channelId = '';
let privateId = '';
/** name -> fileId, so assertions can read like the panel does */
const uploaded = new Map<string, string>();

async function registerHuman(email: string, name: string): Promise<string> {
  const res = await auth.register(email, { password: 'password123', displayName: name, autoVerify: true });
  if (!('token' in res)) throw new Error('expected autoVerify session');
  return res.user.id;
}

/** Upload a file of a given size and attach it to a fresh message. */
async function share(
  uploaderId: string,
  target: string,
  name: string,
  mimeType: string,
  sizeBytes: number,
): Promise<string> {
  const dto = await fl.uploadFile(workspaceId, uploaderId, name, mimeType, Buffer.alloc(sizeBytes, 7));
  uploaded.set(name, dto.id);
  const m = await msg.sendMessage(target, uploaderId, newId(), name, undefined, [dto.id]);
  return m.id;
}

beforeAll(async () => {
  await migrate(process.env.DATABASE_URL!);
  await db.execute(`TRUNCATE users, workspaces, sessions, invites, pending_signups RESTART IDENTITY CASCADE` as never);
  ownerId = await registerHuman('owner@example.test', 'Owner');
  matesId = await registerHuman('mate@example.test', 'Mate');
  outsiderId = await registerHuman('outsider@example.test', 'Outsider');
  const wsDto = await ws.createWorkspace(ownerId, 'Channel Files WS', `chanfiles-${Date.now()}`);
  workspaceId = wsDto.id;
  await db.insert(schema.workspaceMembers).values({ workspaceId, userId: matesId, role: 'member' });

  channelId = (await ch.createChannel(workspaceId, ownerId, 'files-demo')).id;
  privateId = (await ch.createChannel(workspaceId, ownerId, 'files-private', undefined, true)).id;

  // Shared oldest -> newest, with sizes and names deliberately out of order so
  // each sort produces a distinguishable sequence.
  await share(ownerId, channelId, 'zeta-notes.txt', 'text/plain', 300);
  await share(matesId, channelId, 'alpha-report.pdf', 'application/pdf', 900);
  await share(ownerId, channelId, 'mid-deck.key', 'application/octet-stream', 100);

  // one attachment that must never show up: its message gets deleted
  const doomed = await share(ownerId, channelId, 'retracted.zip', 'application/zip', 500);
  await msg.deleteMessage(doomed, ownerId);
});

afterAll(async () => {
  await closeDb();
  fs.rmSync(process.env.FLOW_FILE_DIR!, { recursive: true, force: true });
});

const names = (page: { files: { name: string }[] }) => page.files.map((f) => f.name);

describe('listChannelFiles', () => {
  it('returns files newest-first by default and excludes deleted messages', async () => {
    const page = await fl.listChannelFiles(channelId, ownerId, 'newest', undefined, 30);
    expect(names(page)).toEqual(['mid-deck.key', 'alpha-report.pdf', 'zeta-notes.txt']);
    expect(page.total).toBe(3);
    expect(page.nextCursor).toBeNull();
    expect(names(page)).not.toContain('retracted.zip');
  });

  it('sorts oldest, by name, and by size', async () => {
    const oldest = await fl.listChannelFiles(channelId, ownerId, 'oldest', undefined, 30);
    expect(names(oldest)).toEqual(['zeta-notes.txt', 'alpha-report.pdf', 'mid-deck.key']);

    const byName = await fl.listChannelFiles(channelId, ownerId, 'name', undefined, 30);
    expect(names(byName)).toEqual(['alpha-report.pdf', 'mid-deck.key', 'zeta-notes.txt']);

    const bySize = await fl.listChannelFiles(channelId, ownerId, 'size', undefined, 30);
    expect(names(bySize)).toEqual(['alpha-report.pdf', 'zeta-notes.txt', 'mid-deck.key']);
  });

  it('carries the metadata a row needs', async () => {
    const page = await fl.listChannelFiles(channelId, ownerId, 'name', undefined, 30);
    const pdf = page.files.find((f) => f.name === 'alpha-report.pdf')!;
    expect(pdf.id).toBe(uploaded.get('alpha-report.pdf'));
    expect(pdf.mimeType).toBe('application/pdf');
    expect(pdf.sizeBytes).toBe(900);
    expect(pdf.userId).toBe(matesId);
    expect(pdf.uploaderName).toBe('Mate');
    expect(pdf.messageId).toBeTruthy();
    expect(Date.parse(pdf.createdAt)).toBeGreaterThan(0);
  });

  it('pages with the cursor without repeating or dropping rows', async () => {
    for (const sort of ['newest', 'oldest', 'name', 'size'] as const) {
      const all = names(await fl.listChannelFiles(channelId, ownerId, sort, undefined, 30));
      const seen: string[] = [];
      let cursor: string | null | undefined;
      do {
        const page = await fl.listChannelFiles(channelId, ownerId, sort, cursor ?? undefined, 1);
        seen.push(...names(page));
        cursor = page.nextCursor;
      } while (cursor);
      expect(seen, `paging ${sort}`).toEqual(all);
    }
  });

  it('reports the full total on a partial page', async () => {
    const page = await fl.listChannelFiles(channelId, ownerId, 'newest', undefined, 2);
    expect(page.files).toHaveLength(2);
    expect(page.total).toBe(3);
    expect(page.nextCursor).toBeTruthy();
  });

  it('is empty for a channel nobody has shared in', async () => {
    const quiet = await ch.createChannel(workspaceId, ownerId, 'quiet-room');
    const page = await fl.listChannelFiles(quiet.id, ownerId, 'newest', undefined, 30);
    expect(page.files).toEqual([]);
    expect(page.total).toBe(0);
    expect(page.nextCursor).toBeNull();
  });

  it('enforces channel visibility', async () => {
    // public channel: any workspace member may read it, like the messages
    await expect(fl.listChannelFiles(channelId, matesId, 'newest', undefined, 30)).resolves.toBeTruthy();
    // private channel: non-members cannot
    await expect(fl.listChannelFiles(privateId, matesId, 'newest', undefined, 30)).rejects.toThrow();
    // non-member of the workspace at all
    await expect(fl.listChannelFiles(channelId, outsiderId, 'newest', undefined, 30)).rejects.toThrow();
  });

  it('rejects a malformed cursor', async () => {
    await expect(fl.listChannelFiles(channelId, ownerId, 'newest', 'not-a-cursor', 30)).rejects.toThrow();
  });
});
