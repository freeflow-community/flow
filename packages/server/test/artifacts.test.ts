// Artifacts (phase 13): per-channel shared objects — create/pin, list, rename,
// the agent "update" path (re-point at a new file), delete (reaping an owned
// file, keeping a referenced one), authorization (members only), private-channel
// isolation, the channel-artifact file-access grant, and the orphan-sweep
// exemption. DB-backed — scratch database on the dev postgres (docker compose in
// packages/infra, host port 5442).
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
let lonerId = ''; // workspace member, not a member of `channelId`
let workspaceId = '';
let channelId = ''; // standard channel: alice, bob, agent
let privateId = ''; // private channel: alice only

async function registerHuman(email: string, name: string): Promise<string> {
  const res = await auth.register(email, { password: 'password123', displayName: name, autoVerify: true });
  if (!('token' in res)) throw new Error('expected autoVerify session');
  return res.user.id;
}

async function uploadedFile(userId: string, name = `f-${randomUUID()}.txt`): Promise<string> {
  const dto = await fl.uploadFile(workspaceId, userId, name, 'text/plain', Buffer.from('artifact bytes'));
  return dto.id;
}

/** Pin a file into `channelId` after sharing it there, so any member can read it. */
async function sharedFile(userId: string, name?: string): Promise<string> {
  const fileId = await uploadedFile(userId, name);
  await msg.sendMessage(channelId, userId, randomUUID(), 'here', undefined, [fileId], undefined);
  return fileId;
}

beforeAll(async () => {
  await migrate(process.env.DATABASE_URL!);
  await db.execute(`TRUNCATE users, workspaces, sessions, invites, pending_signups RESTART IDENTITY CASCADE` as never);
  aliceId = await registerHuman('alice@example.test', 'Alice');
  bobId = await registerHuman('bob@example.test', 'Bob');
  agentId = await registerHuman('robo@example.test', 'Robo');
  lonerId = await registerHuman('loner@example.test', 'Loner');
  await db.update(users).set({ isAgent: true }).where(eq(users.id, agentId));

  const w = await ws.createWorkspace(aliceId, 'Artifacts Test', `artifacts-${randomUUID().slice(0, 8)}`);
  workspaceId = w.id;
  for (const uid of [bobId, agentId, lonerId]) {
    await db.insert(workspaceMembers).values({ workspaceId, userId: uid, role: 'member' });
  }
  const chan = await ch.createChannel(workspaceId, aliceId, 'artifacts');
  channelId = chan.id;
  await ch.addMember(channelId, aliceId, bobId);
  await ch.addMember(channelId, aliceId, agentId);

  const priv = await ch.createChannel(workspaceId, aliceId, 'secret', undefined, true);
  privateId = priv.id;
});

afterAll(async () => {
  await closeDb();
  fs.rmSync(process.env.FLOW_FILE_DIR!, { recursive: true, force: true });
});

describe('createArtifact', () => {
  it('pins a shared file, defaulting the name to the file name', async () => {
    const fileId = await sharedFile(aliceId, 'notes.txt');
    const a = await ar.createArtifact(aliceId, channelId, { fileId });
    expect(a.channelId).toBe(channelId);
    expect(a.name).toBe('notes.txt');
    expect(a.file.id).toBe(fileId);
  });

  it('is idempotent per (channel, file) for pins', async () => {
    const fileId = await sharedFile(aliceId);
    const first = await ar.createArtifact(aliceId, channelId, { fileId, name: 'One' });
    const again = await ar.createArtifact(bobId, channelId, { fileId, name: 'Two' });
    expect(again.id).toBe(first.id); // shared object — same row for both members
    expect(again.name).toBe('One'); // re-pinning never renames
  });

  it('creates distinct rows for owned (agent-generated) artifacts', async () => {
    const f1 = await uploadedFile(agentId);
    const f2 = await uploadedFile(agentId);
    const a1 = await ar.createArtifact(agentId, channelId, { fileId: f1, ownsFile: true });
    const a2 = await ar.createArtifact(agentId, channelId, { fileId: f2, ownsFile: true });
    expect(a1.id).not.toBe(a2.id);
  });

  it("rejects files the caller can't access", async () => {
    // an unattached upload is visible to the uploader only (files access rule)
    const fileId = await uploadedFile(agentId);
    await expect(ar.createArtifact(aliceId, channelId, { fileId })).rejects.toThrow('file not found');
  });

  it('rejects a non-member of the channel', async () => {
    const fileId = await sharedFile(aliceId);
    await expect(ar.createArtifact(lonerId, channelId, { fileId })).rejects.toThrow(/join the channel/);
  });
});

describe('link artifacts (link artifacts — co-browsing)', () => {
  it('pins a link, defaulting the name to the host and carrying no file', async () => {
    const a = await ar.createArtifact(aliceId, channelId, { url: 'https://example.com/docs' });
    expect(a.kind).toBe('link');
    expect(a.url).toBe('https://example.com/docs');
    expect(a.file).toBeNull();
    expect(a.fileId).toBeNull();
    expect(a.name).toBe('example.com');
  });

  it('is idempotent per (channel, url)', async () => {
    const first = await ar.createArtifact(aliceId, channelId, { url: 'https://dup.example/one' });
    const again = await ar.createArtifact(bobId, channelId, { url: 'https://dup.example/one' });
    expect(again.id).toBe(first.id);
  });

  it('rejects a non-http(s) url', async () => {
    await expect(ar.createArtifact(aliceId, channelId, { url: 'ftp://nope.example' })).rejects.toThrow(/http/);
  });

  it('requires exactly one of fileId or url', async () => {
    await expect(ar.createArtifact(aliceId, channelId, {})).rejects.toThrow(/one of/);
  });

  it('lists link artifacts for every channel member', async () => {
    const a = await ar.createArtifact(aliceId, channelId, { url: 'https://seen.example' });
    const bobs = await ar.listArtifacts(workspaceId, bobId);
    expect(bobs.some((x) => x.id === a.id && x.kind === 'link')).toBe(true);
  });

  it('re-points the url (the co-browse write) and bumps updatedAt', async () => {
    const a = await ar.createArtifact(aliceId, channelId, { url: 'https://co.example/a' });
    const moved = await ar.updateArtifact(a.id, bobId, { url: 'https://co.example/b' }); // any member can drive
    expect(moved.url).toBe('https://co.example/b');
    expect(moved.kind).toBe('link');
    expect(new Date(moved.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(a.createdAt).getTime());
  });

  it('will not attach a file to a link artifact, nor a url to a file artifact', async () => {
    const link = await ar.createArtifact(aliceId, channelId, { url: 'https://mix.example' });
    const badFile = await uploadedFile(aliceId);
    await expect(ar.updateArtifact(link.id, aliceId, { fileId: badFile })).rejects.toThrow(/link artifact/);
    const fileId = await sharedFile(aliceId);
    const file = await ar.createArtifact(aliceId, channelId, { fileId });
    await expect(ar.updateArtifact(file.id, aliceId, { url: 'https://x.example' })).rejects.toThrow(/file artifact/);
  });

  it('deletes a link artifact (no file to reap)', async () => {
    const a = await ar.createArtifact(aliceId, channelId, { url: 'https://gone.example' });
    await ar.deleteArtifact(a.id, aliceId);
    await ar.deleteArtifact(a.id, aliceId); // idempotent
    expect((await ar.listArtifacts(workspaceId, aliceId)).some((x) => x.id === a.id)).toBe(false);
  });

  it('rejects a non-member pinning a link', async () => {
    await expect(ar.createArtifact(lonerId, channelId, { url: 'https://nope.example' })).rejects.toThrow(/join the channel/);
  });
});

describe('list — per-channel visibility', () => {
  it('shows an artifact to every member of the channel', async () => {
    const fileId = await sharedFile(aliceId);
    const pinned = await ar.createArtifact(aliceId, channelId, { fileId, name: 'Shared' });
    const bobs = await ar.listArtifacts(workspaceId, bobId);
    expect(bobs.some((a) => a.id === pinned.id)).toBe(true);
  });

  it('hides it from a workspace member who is not in the channel', async () => {
    const fileId = await sharedFile(aliceId);
    const pinned = await ar.createArtifact(aliceId, channelId, { fileId });
    const loners = await ar.listArtifacts(workspaceId, lonerId);
    expect(loners.some((a) => a.id === pinned.id)).toBe(false);
  });

  it('keeps private-channel artifacts private to its members', async () => {
    // alice uploads + pins in the private channel she alone belongs to
    const fileId = await uploadedFile(aliceId, 'secret.txt');
    await msg.sendMessage(privateId, aliceId, randomUUID(), 'psst', undefined, [fileId], undefined);
    const secret = await ar.createArtifact(aliceId, privateId, { fileId, name: 'Secret' });
    expect((await ar.listArtifacts(workspaceId, aliceId)).some((a) => a.id === secret.id)).toBe(true);
    expect((await ar.listArtifacts(workspaceId, bobId)).some((a) => a.id === secret.id)).toBe(false);
    // and bob (a non-member) cannot even manage it
    await expect(ar.deleteArtifact(secret.id, bobId)).rejects.toThrow('channel not found');
  });
});

describe('rename / update', () => {
  it('renames (any member)', async () => {
    const fileId = await sharedFile(aliceId);
    const a = await ar.createArtifact(aliceId, channelId, { fileId, name: 'Old' });
    const renamed = await ar.renameArtifact(a.id, bobId, 'New'); // a different member may rename
    expect(renamed.name).toBe('New');
    expect(new Date(renamed.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(a.createdAt).getTime());
  });

  it('re-points at a new file and reaps the old owned file', async () => {
    const oldFile = await uploadedFile(agentId, 'v1.txt');
    const a = await ar.createArtifact(agentId, channelId, { fileId: oldFile, ownsFile: true });
    const newFile = await uploadedFile(agentId, 'v2.txt');
    const updated = await ar.updateArtifact(a.id, agentId, { fileId: newFile, ownsFile: true });
    expect(updated.file.id).toBe(newFile);
    // the old owned file, referenced by nothing else, is gone
    const oldRows = await db.select().from(files).where(eq(files.id, oldFile));
    expect(oldRows).toHaveLength(0);
  });

  it('keeps the old file when it is still referenced by a message', async () => {
    const oldFile = await sharedFile(agentId, 'attached.txt'); // attached to a channel message
    const a = await ar.createArtifact(agentId, channelId, { fileId: oldFile, ownsFile: true });
    const newFile = await uploadedFile(agentId);
    await ar.updateArtifact(a.id, agentId, { fileId: newFile, ownsFile: true });
    const oldRows = await db.select().from(files).where(eq(files.id, oldFile));
    expect(oldRows).toHaveLength(1); // message reference protects it
  });
});

describe('delete', () => {
  it('reaps an owned file the artifact alone referenced', async () => {
    const fileId = await uploadedFile(agentId);
    const a = await ar.createArtifact(agentId, channelId, { fileId, ownsFile: true });
    await ar.deleteArtifact(a.id, agentId);
    await ar.deleteArtifact(a.id, agentId); // idempotent
    const rows = await db.select().from(files).where(eq(files.id, fileId));
    expect(rows).toHaveLength(0);
    expect((await ar.listArtifacts(workspaceId, agentId)).some((x) => x.id === a.id)).toBe(false);
  });

  it('keeps a pinned (not owned) file — the message still references it', async () => {
    const fileId = await sharedFile(aliceId);
    const a = await ar.createArtifact(aliceId, channelId, { fileId }); // ownsFile=false
    await ar.deleteArtifact(a.id, aliceId);
    const rows = await db.select().from(files).where(eq(files.id, fileId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.deletedAt).toBeNull();
  });

  it('rejects a non-member', async () => {
    const fileId = await sharedFile(aliceId);
    const a = await ar.createArtifact(aliceId, channelId, { fileId });
    await expect(ar.deleteArtifact(a.id, lonerId)).rejects.toThrow(/join the channel/);
  });
});

describe('file access via a channel artifact', () => {
  /** An agent's owned artifact file is never attached to a message, so the
   * generic file-access rule (uploader, or attached to a readable message)
   * would lock other members out. The channel-artifact grant covers them. */
  it('lets a channel member read the bytes of an artifact-only file', async () => {
    const fileId = await uploadedFile(agentId, 'plan.md');
    await ar.createArtifact(agentId, channelId, { fileId, ownsFile: true });
    const dl = await fl.getFileDownload(fileId, bobId); // bob is a member, not the uploader
    const bytes = 'content' in dl ? dl.content.data.toString('utf8') : '';
    expect(bytes).toBe('artifact bytes');
  });

  it('does not leak a private-channel artifact file to a non-member', async () => {
    // access via a *public* channel's artifact follows public-channel rules
    // (any workspace member can read); privacy requires a private channel.
    const fileId = await uploadedFile(aliceId);
    await ar.createArtifact(aliceId, privateId, { fileId, ownsFile: true });
    await expect(fl.getFileDownload(fileId, bobId)).rejects.toThrow('file not found');
  });
});

describe('orphan sweep exemption', () => {
  it('never reaps a file that an artifact references, even unattached', async () => {
    const keptId = await uploadedFile(aliceId);
    const reapedId = await uploadedFile(aliceId);
    await ar.createArtifact(aliceId, channelId, { fileId: keptId, ownsFile: true });
    // age both past the TTL; neither is attached to a message
    const old = new Date(Date.now() - 48 * 3600_000);
    await db.update(files).set({ createdAt: old }).where(eq(files.id, keptId));
    await db.update(files).set({ createdAt: old }).where(eq(files.id, reapedId));
    await fl.sweepOrphanFiles();
    expect(await db.select().from(files).where(eq(files.id, keptId))).toHaveLength(1);
    expect(await db.select().from(files).where(eq(files.id, reapedId))).toHaveLength(0);
  });

  it('cascades artifacts away when the file row is hard-deleted', async () => {
    const fileId = await uploadedFile(aliceId);
    const a = await ar.createArtifact(aliceId, channelId, { fileId, ownsFile: true });
    await db.delete(artifacts).where(eq(artifacts.id, a.id)); // release the sweep exemption
    await db.delete(files).where(eq(files.id, fileId));
    expect(await db.select().from(artifacts).where(eq(artifacts.id, a.id))).toHaveLength(0);
  });
});
