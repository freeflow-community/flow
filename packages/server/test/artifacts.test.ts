// Artifacts (phase 9): personal per-user bookmarks — create/list/rename/delete,
// idempotency, access control, the channel fan-out (humans only), and the
// orphan-sweep exemption for artifact-only files. DB-backed — scratch database
// on the dev postgres (docker compose in packages/infra, host port 5442).
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATABASE_URL = process.env.FLOW_TEST_DATABASE_URL
  ?? 'postgres://flow:flow_dev@localhost:5442/flow_artifacts_test';
process.env.FLOW_DATA_KEY = randomBytes(32).toString('base64');
process.env.FLOW_FILE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-artifacts-test-'));
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
const { migrate } = await import('../src/db/migrate.js');
const { db, schema, closeDb } = await import('../src/db/index.js');
const auth = await import('../src/services/auth.js');
const ws = await import('../src/services/workspaces.js');
const ch = await import('../src/services/channels.js');
const msg = await import('../src/services/messages.js');
const fl = await import('../src/services/files.js');
const ar = await import('../src/services/artifacts.js');
const { eq } = await import('drizzle-orm');

const { artifacts, files, users, workspaceMembers } = schema;

let aliceId = '';
let bobId = '';
let agentId = '';
let workspaceId = '';
let channelId = ''; // standard channel: alice, bob, agent

async function registerHuman(email: string, name: string): Promise<string> {
  const res = await auth.register(email, { password: 'password123', displayName: name, autoVerify: true });
  if (!('token' in res)) throw new Error('expected autoVerify session');
  return res.user.id;
}

async function uploadedFile(userId: string, name = `f-${randomUUID()}.txt`): Promise<string> {
  const dto = await fl.uploadFile(workspaceId, userId, name, 'text/plain', Buffer.from('artifact bytes'));
  return dto.id;
}

beforeAll(async () => {
  await migrate(process.env.DATABASE_URL!);
  await db.execute(`TRUNCATE users, workspaces, sessions, invites, pending_signups RESTART IDENTITY CASCADE` as never);
  aliceId = await registerHuman('alice@example.test', 'Alice');
  bobId = await registerHuman('bob@example.test', 'Bob');
  agentId = await registerHuman('robo@example.test', 'Robo');
  await db.update(users).set({ isAgent: true }).where(eq(users.id, agentId));

  const w = await ws.createWorkspace(aliceId, 'Artifacts Test', `artifacts-${randomUUID().slice(0, 8)}`);
  workspaceId = w.id;
  for (const uid of [bobId, agentId]) {
    await db.insert(workspaceMembers).values({ workspaceId, userId: uid, role: 'member' });
  }
  const chan = await ch.createChannel(workspaceId, aliceId, 'artifacts');
  channelId = chan.id;
  await ch.addMember(channelId, aliceId, bobId);
  await ch.addMember(channelId, aliceId, agentId);
});

afterAll(async () => {
  await closeDb();
  fs.rmSync(process.env.FLOW_FILE_DIR!, { recursive: true, force: true });
});

describe('createArtifact', () => {
  it('bookmarks an own upload, defaulting the name to the file name', async () => {
    const fileId = await uploadedFile(aliceId, 'notes.txt');
    const a = await ar.createArtifact(aliceId, fileId, undefined);
    expect(a.userId).toBe(aliceId);
    expect(a.name).toBe('notes.txt');
    expect(a.file.id).toBe(fileId);
  });

  it('is idempotent per (user, file)', async () => {
    const fileId = await uploadedFile(aliceId);
    const first = await ar.createArtifact(aliceId, fileId, 'One');
    const again = await ar.createArtifact(aliceId, fileId, 'Two');
    expect(again.id).toBe(first.id);
    expect(again.name).toBe('One'); // re-bookmarking never renames
  });

  it("rejects files the caller can't access", async () => {
    // alice's upload is unattached — visible to the uploader only (files access rule)
    const fileId = await uploadedFile(aliceId);
    await expect(ar.createArtifact(bobId, fileId, undefined)).rejects.toThrow('file not found');
  });

  it('allows bookmarking a file another member shared in an accessible channel', async () => {
    const fileId = await uploadedFile(aliceId);
    await msg.sendMessage(channelId, aliceId, randomUUID(), 'here you go', undefined, [fileId], undefined);
    const a = await ar.createArtifact(bobId, fileId, undefined);
    expect(a.userId).toBe(bobId);
  });
});

describe('list / rename / delete', () => {
  it('lists only the caller-owned artifacts for the workspace, newest first', async () => {
    const fileId = await uploadedFile(aliceId);
    const mine = await ar.createArtifact(aliceId, fileId, 'Newest');
    const listA = await ar.listArtifacts(workspaceId, aliceId);
    expect(listA[0]!.id).toBe(mine.id);
    expect(listA.every((a) => a.userId === aliceId)).toBe(true);
  });

  it('renames (owner only)', async () => {
    const fileId = await uploadedFile(aliceId);
    const a = await ar.createArtifact(aliceId, fileId, 'Old');
    const renamed = await ar.renameArtifact(a.id, aliceId, 'New');
    expect(renamed.name).toBe('New');
    await expect(ar.renameArtifact(a.id, bobId, 'Steal')).rejects.toThrow('artifact not found');
  });

  it('deletes the bookmark without touching the file', async () => {
    const fileId = await uploadedFile(aliceId);
    const a = await ar.createArtifact(aliceId, fileId, undefined);
    await ar.deleteArtifact(a.id, aliceId);
    await ar.deleteArtifact(a.id, aliceId); // idempotent
    const rows = await db.select().from(files).where(eq(files.id, fileId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.deletedAt).toBeNull();
    const listed = await ar.listArtifacts(workspaceId, aliceId);
    expect(listed.some((x) => x.id === a.id)).toBe(false);
  });

  it("won't delete someone else's artifact", async () => {
    const fileId = await uploadedFile(aliceId);
    const a = await ar.createArtifact(aliceId, fileId, undefined);
    await expect(ar.deleteArtifact(a.id, bobId)).rejects.toThrow('artifact not found');
  });
});

describe('shareArtifact (MCP fan-out)', () => {
  it('creates one personal artifact per human member, excluding agents', async () => {
    const fileId = await uploadedFile(agentId, 'report.txt');
    const created = await ar.shareArtifact(channelId, agentId, fileId, 'Weekly report');
    const owners = created.map((a) => a.userId).sort();
    expect(owners).toEqual([aliceId, bobId].sort());
    expect(created.every((a) => a.name === 'Weekly report')).toBe(true);
  });

  it('skips members who already bookmarked the file', async () => {
    const fileId = await uploadedFile(agentId);
    await ar.shareArtifact(channelId, agentId, fileId, undefined);
    const second = await ar.shareArtifact(channelId, agentId, fileId, undefined);
    expect(second).toHaveLength(0);
  });

  it('requires the caller to be a channel member', async () => {
    const outsiderId = await registerHuman('mallory@example.test', 'Mallory');
    await db.insert(workspaceMembers).values({ workspaceId, userId: outsiderId, role: 'member' });
    const fileId = await uploadedFile(aliceId);
    const priv = await ch.createChannel(workspaceId, aliceId, `priv-${randomUUID().slice(0, 8)}`, undefined, true);
    await expect(ar.shareArtifact(priv.id, outsiderId, fileId, undefined)).rejects.toThrow();
  });
});

describe('orphan sweep exemption', () => {
  it('never reaps a file that an artifact references, even unattached', async () => {
    const keptId = await uploadedFile(aliceId);
    const reapedId = await uploadedFile(aliceId);
    await ar.createArtifact(aliceId, keptId, undefined);
    // age both past the TTL; neither is attached to a message
    const old = new Date(Date.now() - 48 * 3600_000);
    await db.update(files).set({ createdAt: old }).where(eq(files.id, keptId));
    await db.update(files).set({ createdAt: old }).where(eq(files.id, reapedId));
    await fl.sweepOrphanFiles();
    const kept = await db.select().from(files).where(eq(files.id, keptId));
    const reaped = await db.select().from(files).where(eq(files.id, reapedId));
    expect(kept).toHaveLength(1);
    expect(reaped).toHaveLength(0);
  });

  it('cascades artifacts away when the file row is hard-deleted', async () => {
    const fileId = await uploadedFile(aliceId);
    const a = await ar.createArtifact(aliceId, fileId, undefined);
    await db.delete(artifacts).where(eq(artifacts.id, a.id)); // release the sweep exemption
    await db.delete(files).where(eq(files.id, fileId));
    const rows = await db.select().from(artifacts).where(eq(artifacts.id, a.id));
    expect(rows).toHaveLength(0);
  });
});
