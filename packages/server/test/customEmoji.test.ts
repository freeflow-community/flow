// Custom emoji (#175): workspace-scoped `:shortcode:` images used as reactions.
//
// The interesting risk is the *transport*, not the storage: the reaction emoji
// is a URL path segment (`PUT /v1/messages/:id/reactions/:emoji`) that gets
// routed, decoded by Fastify and then decodeURIComponent'd again by the
// handler. A shortcode has to survive that intact, both percent-encoded and
// raw, or the feature is broken in a way no service-level test would catch —
// so these go through the real app with app.inject().
//
// DB-backed — scratch database on the dev postgres (docker compose in
// packages/infra, host port 5442).
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

process.env.DATABASE_URL = process.env.FLOW_TEST_DATABASE_URL
  ?? 'postgres://flow:flow_dev@localhost:5442/flow_custom_emoji_test';
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
const auth = await import('../src/services/auth.js');
const ws = await import('../src/services/workspaces.js');
const ch = await import('../src/services/channels.js');
const msg = await import('../src/services/messages.js');
const rx = await import('../src/services/reactions.js');
const wse = await import('../src/services/workspaceEmoji.js');
const { eq } = await import('drizzle-orm');

const { files } = schema;

let app: FastifyInstance;
let aliceId = ''; // workspace owner → admin
let bobId = ''; // plain member
let aliceToken = '';
let bobToken = '';
let workspaceId = '';
let channelId = '';
let messageId = '';

async function registerHuman(email: string, name: string): Promise<{ id: string; token: string }> {
  const res = await auth.register(email, { password: 'password123', displayName: name, autoVerify: true });
  if (!('token' in res)) throw new Error('expected autoVerify session');
  return { id: res.user.id, token: res.token };
}

/** A ready image row, as the presign flow would leave one. The bytes never
 * matter here — nothing in this path reads the blob. */
async function makeImageFile(opts: { mimeType?: string; sizeBytes?: number } = {}): Promise<string> {
  const id = randomUUID();
  await db.insert(files).values({
    id,
    workspaceId,
    userId: aliceId,
    name: 'parrot.png',
    mimeType: opts.mimeType ?? 'image/png',
    sizeBytes: opts.sizeBytes ?? 4096,
    storageKey: `files/${id}`,
    status: 'ready',
  });
  return id;
}

function authed(token: string) {
  return { authorization: `Bearer ${token}` };
}

beforeAll(async () => {
  await migrate(process.env.DATABASE_URL!);
  await db.execute(`TRUNCATE users, workspaces, sessions, invites, pending_signups RESTART IDENTITY CASCADE` as never);
  const alice = await registerHuman('alice@example.test', 'Alice');
  const bob = await registerHuman('bob@example.test', 'Bob');
  aliceId = alice.id;
  aliceToken = alice.token;
  bobId = bob.id;
  bobToken = bob.token;

  const w = await ws.createWorkspace(aliceId, 'Emoji Test', `emoji-${randomUUID().slice(0, 8)}`);
  workspaceId = w.id;
  await db.insert(schema.workspaceMembers).values({ workspaceId, userId: bobId, role: 'member' });

  const chan = await ch.createChannel(workspaceId, aliceId, 'emoji-lab'); // 'general' is auto-created
  channelId = chan.id;
  await ch.addMember(channelId, aliceId, bobId);
  const m = await msg.sendMessage(channelId, aliceId, randomUUID(), 'ship it');
  messageId = m.id;

  app = buildApp();
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await closeDb();
});

describe('managing the set', () => {
  it('registers an uploaded image under a shortcode', async () => {
    const fileId = await makeImageFile();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/workspaces/${workspaceId}/emoji`,
      headers: authed(aliceToken),
      payload: { shortcode: 'party-parrot', fileId },
    });
    expect(res.statusCode).toBe(201);
    const dto = res.json();
    expect(dto.shortcode).toBe('party-parrot');
    expect(dto.emoji).toBe(':party-parrot:'); // clients key their map on this
    expect(dto.fileId).toBe(fileId);
  });

  it('lists for any member, not just admins', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/workspaces/${workspaceId}/emoji`,
      headers: authed(bobToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().emoji.map((e: { emoji: string }) => e.emoji)).toContain(':party-parrot:');
  });

  it('refuses creation by a non-admin member', async () => {
    const fileId = await makeImageFile();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/workspaces/${workspaceId}/emoji`,
      headers: authed(bobToken),
      payload: { shortcode: 'bob-was-here', fileId },
    });
    expect(res.statusCode).toBe(403);
  });

  it('refuses a duplicate shortcode', async () => {
    const fileId = await makeImageFile();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/workspaces/${workspaceId}/emoji`,
      headers: authed(aliceToken),
      payload: { shortcode: 'party-parrot', fileId },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('shortcode_taken');
  });

  it('refuses a shortcode that shadows a standard unicode one', async () => {
    // :fire: already expands to 🔥 in message text, so a custom one would make
    // the same typed string mean two different things.
    const fileId = await makeImageFile();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/workspaces/${workspaceId}/emoji`,
      headers: authed(aliceToken),
      payload: { shortcode: 'fire', fileId },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('reserved_shortcode');
  });

  it('refuses a non-image and an oversized image', async () => {
    const pdf = await makeImageFile({ mimeType: 'application/pdf' });
    const huge = await makeImageFile({ sizeBytes: 2 * 1024 * 1024 });
    for (const [fileId, code] of [[pdf, 'unsupported_image'], [huge, 'image_too_large']] as const) {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/workspaces/${workspaceId}/emoji`,
        headers: authed(aliceToken),
        payload: { shortcode: `probe-${randomUUID().slice(0, 6)}`, fileId },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe(code);
    }
  });

  it('refuses a file from another workspace', async () => {
    const other = await ws.createWorkspace(bobId, 'Other', `other-${randomUUID().slice(0, 8)}`);
    const id = randomUUID();
    await db.insert(files).values({
      id,
      workspaceId: other.id,
      userId: bobId,
      name: 'x.png',
      mimeType: 'image/png',
      sizeBytes: 1024,
      storageKey: `files/${id}`,
      status: 'ready',
    });
    const res = await app.inject({
      method: 'POST',
      url: `/v1/workspaces/${workspaceId}/emoji`,
      headers: authed(aliceToken),
      payload: { shortcode: 'stolen', fileId: id },
    });
    expect(res.statusCode).toBe(404);
  });

  it('normalises case so :Tada: and :tada: cannot both exist', async () => {
    const fileId = await makeImageFile();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/workspaces/${workspaceId}/emoji`,
      headers: authed(aliceToken),
      payload: { shortcode: 'ShipIt', fileId },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().shortcode).toBe('shipit');
  });
});

describe('reacting with a custom emoji over HTTP', () => {
  // The point of the whole file: the shortcode is a URL path segment.
  it('round-trips a percent-encoded shortcode through the path', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/v1/messages/${messageId}/reactions/${encodeURIComponent(':party-parrot:')}`,
      headers: authed(bobToken),
    });
    expect(res.statusCode).toBe(200);
    const agg = res.json().reactions;
    expect(agg).toContainEqual({ emoji: ':party-parrot:', count: 1, userIds: [bobId] });
  });

  it('round-trips a raw, unencoded shortcode too', async () => {
    // Colons are legal in a path segment (RFC 3986 pchar), so a hand-written
    // client that does not encode must land on the same reaction, not a second.
    const res = await app.inject({
      method: 'PUT',
      url: `/v1/messages/${messageId}/reactions/:party-parrot:`,
      headers: authed(aliceToken),
    });
    expect(res.statusCode).toBe(200);
    const agg = res.json().reactions.find((r: { emoji: string }) => r.emoji === ':party-parrot:');
    expect(agg.count).toBe(2);
    expect(agg.userIds).toEqual([bobId, aliceId]);
  });

  it('still accepts unicode emoji', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/v1/messages/${messageId}/reactions/${encodeURIComponent('🎉')}`,
      headers: authed(aliceToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().reactions.some((r: { emoji: string }) => r.emoji === '🎉')).toBe(true);
  });

  it('rejects a well-formed shortcode that is not in this workspace', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/v1/messages/${messageId}/reactions/${encodeURIComponent(':not-a-real-emoji:')}`,
      headers: authed(aliceToken),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('unknown_emoji');
  });

  it('rejects malformed junk that is neither emoji nor shortcode', async () => {
    for (const bad of [':UPPER:', ':a:', 'not-emoji', '::', ':has spaces:']) {
      const res = await app.inject({
        method: 'PUT',
        url: `/v1/messages/${messageId}/reactions/${encodeURIComponent(bad)}`,
        headers: authed(aliceToken),
      });
      expect(res.statusCode, `expected ${bad} to be rejected`).toBe(400);
    }
  });

  it('removes a custom reaction through the path', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/messages/${messageId}/reactions/${encodeURIComponent(':party-parrot:')}`,
      headers: authed(bobToken),
    });
    expect(res.statusCode).toBe(200);
    const agg = res.json().reactions.find((r: { emoji: string }) => r.emoji === ':party-parrot:');
    expect(agg.count).toBe(1);
    expect(agg.userIds).toEqual([aliceId]);
  });
});

describe('deleting an emoji that is in use', () => {
  it('leaves existing reactions removable, and blocks new ones', async () => {
    const fileId = await makeImageFile();
    const created = await wse.createEmoji(workspaceId, aliceId, 'doomed', fileId);
    await rx.addReaction(messageId, aliceId, ':doomed:');

    await wse.deleteEmoji(created.id, aliceId);

    // The reaction survives as a plain string — clients render the raw
    // shortcode rather than losing who reacted.
    const still = await rx.reactionsForMessages([messageId]);
    expect(still.get(messageId)?.some((r) => r.emoji === ':doomed:')).toBe(true);

    // ...but it can't be added again.
    await expect(rx.addReaction(messageId, bobId, ':doomed:')).rejects.toThrow();

    // ...and whoever reacted can still take it back.
    const after = await rx.removeReaction(messageId, aliceId, ':doomed:');
    expect(after.some((r) => r.emoji === ':doomed:')).toBe(false);
  });

  it('cascades when the backing file row is deleted', async () => {
    const fileId = await makeImageFile();
    const created = await wse.createEmoji(workspaceId, aliceId, 'ephemeral', fileId);
    await db.delete(files).where(eq(files.id, fileId));
    const list = await wse.listEmoji(workspaceId, aliceId);
    expect(list.some((e) => e.id === created.id)).toBe(false);
  });
});
