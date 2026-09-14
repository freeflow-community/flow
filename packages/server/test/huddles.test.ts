// Voice huddle (Phase 1): the transient in-memory store (roster, idempotent
// join, webhook-driven leave, boot-time reconciliation) and the service on
// top of it (authorization, LiveKit token minting, publish-on-change,
// webhook signature verification). See CONTEXT.md (Huddle) and
// decision_log.md (2026-08-20) for the design this follows.
//
// The store half is pure and needs no database; the service half does, so
// this uses the same scratch-database setup as indicators.test.ts (docker
// compose in packages/infra, host port 5442). LiveKit token minting/webhook
// verification are local JWT operations (jose) — no network call — so fake
// LIVEKIT_* credentials are enough to exercise them offline.
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATABASE_URL = process.env.FLOW_TEST_DATABASE_URL
  ?? 'postgres://flow:flow_dev@localhost:5442/flow_huddles_test';
process.env.FLOW_DATA_KEY = randomBytes(32).toString('base64');
process.env.FLOW_FILE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-huddles-test-'));
delete process.env.FLOW_BLOB_DRIVER;
process.env.LIVEKIT_API_KEY = 'test-key';
process.env.LIVEKIT_API_SECRET = 'test-secret-at-least-32-bytes-long';
process.env.LIVEKIT_URL = 'https://test.livekit.cloud';
// #436: the ring is 30s in production. Tests wait on it, so shrink it here —
// read once at module load by services/huddleInvites.ts.
process.env.FLOW_HUDDLE_RING_MS = '150';

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
const { closeDb } = await import('../src/db/index.js');
const auth = await import('../src/services/auth.js');
const ws = await import('../src/services/workspaces.js');
const ch = await import('../src/services/channels.js');
const store = await import('../src/huddles.js');
const hd = await import('../src/services/huddles.js');
const hi = await import('../src/services/huddleInvites.js');
const presence = await import('../src/presence.js');
const { AccessToken } = await import('livekit-server-sdk');

let aliceId = '';
let bobId = '';
let outsiderId = ''; // workspace member, not in `channelId`
let workspaceId = '';
let channelId = '';
let privateId = ''; // private channel: alice + bob only
let dmId = '';
let groupDmId = '';
let archivedId = '';

async function registerHuman(email: string, name: string): Promise<string> {
  const res = await auth.register(email, { password: 'password123', displayName: name, autoVerify: true });
  if (!('token' in res)) throw new Error('expected autoVerify session');
  return res.user.id;
}

/** A signed webhook Authorization header, matching WebhookReceiver's HS256 +
 * sha256-of-body verification (livekit-server-sdk's WebhookReceiver.js). */
async function signWebhook(body: string): Promise<string> {
  const at = new AccessToken(process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!, {});
  at.sha256 = createHash('sha256').update(body).digest('base64');
  return at.toJwt();
}

beforeAll(async () => {
  await migrate(process.env.DATABASE_URL!);
  const { db, schema } = await import('../src/db/index.js');
  await db.execute(`TRUNCATE users, workspaces, sessions, invites, pending_signups RESTART IDENTITY CASCADE` as never);
  aliceId = await registerHuman('alice@example.test', 'Alice');
  bobId = await registerHuman('bob@example.test', 'Bob');
  outsiderId = await registerHuman('outsider@example.test', 'Outsider');

  const w = await ws.createWorkspace(aliceId, 'Huddles Test', `hud-${randomUUID().slice(0, 8)}`);
  workspaceId = w.id;
  const { workspaceMembers } = schema;
  for (const uid of [bobId, outsiderId]) {
    await db.insert(workspaceMembers).values({ workspaceId, userId: uid, role: 'member' });
  }

  const chan = await ch.createChannel(workspaceId, aliceId, 'work');
  channelId = chan.id;
  await ch.addMember(channelId, aliceId, bobId);

  const priv = await ch.createChannel(workspaceId, aliceId, 'secret', undefined, true);
  privateId = priv.id;
  await ch.addMember(privateId, aliceId, bobId);

  const dm = await ch.createDm(workspaceId, aliceId, [bobId]);
  dmId = dm.id;

  const groupDm = await ch.createDm(workspaceId, aliceId, [bobId, outsiderId]);
  groupDmId = groupDm.id;

  const toArchive = await ch.createChannel(workspaceId, aliceId, 'stale');
  archivedId = toArchive.id;
  await ch.archiveChannel(archivedId, aliceId);
});

afterAll(async () => {
  await closeDb();
  fs.rmSync(process.env.FLOW_FILE_DIR!, { recursive: true, force: true });
});

beforeEach(async () => {
  store.resetHuddles();
  hi.resetHuddleInviteTimers();
  presence.resetPresence();
  const { db, schema } = await import('../src/db/index.js');
  await db.delete(schema.huddleInvites);
  await db.delete(schema.messages);
  await db.delete(schema.notifications);
  await db.update(schema.users).set({ statusSuppressAlerts: false });
});

describe('huddle store', () => {
  const CH = 'chan-1';
  const WS = 'ws-1';

  it('reports nothing for a channel with no live huddle', () => {
    expect(store.huddleParticipants(CH)).toEqual([]);
  });

  it('joining adds a participant and reports the roster transition', () => {
    const r = store.joinHuddle(CH, WS, 'u1', 1000);
    expect(r.before).toEqual([]);
    expect(r.after).toEqual([{ userId: 'u1', joinedAt: 1000 }]);
  });

  it('a rejoin is idempotent and keeps the original joinedAt', () => {
    store.joinHuddle(CH, WS, 'u1', 1000);
    const again = store.joinHuddle(CH, WS, 'u1', 5000); // "now" advanced, but same user
    expect(again.before).toEqual([{ userId: 'u1', joinedAt: 1000 }]);
    expect(again.after).toEqual([{ userId: 'u1', joinedAt: 1000 }]); // unchanged
  });

  it('a second joiner keeps the huddle live and both show in the roster', () => {
    store.joinHuddle(CH, WS, 'u1', 1000);
    store.joinHuddle(CH, WS, 'u2', 2000);
    expect(store.huddleParticipants(CH)).toEqual([
      { userId: 'u1', joinedAt: 1000 },
      { userId: 'u2', joinedAt: 2000 },
    ]);
  });

  it('leaving drops one participant; the huddle survives while another remains', () => {
    store.joinHuddle(CH, WS, 'u1', 1000);
    store.joinHuddle(CH, WS, 'u2', 2000);
    const left = store.leaveHuddle(CH, 'u1');
    expect(left.after).toEqual([{ userId: 'u2', joinedAt: 2000 }]);
    expect(left.workspaceId).toBe(WS);
  });

  it('the last leaver ends the huddle', () => {
    store.joinHuddle(CH, WS, 'u1', 1000);
    const left = store.leaveHuddle(CH, 'u1');
    expect(left.after).toEqual([]);
    expect(store.huddleParticipants(CH)).toEqual([]);
  });

  it('leaving a huddle you were never in is a no-op with no known workspace', () => {
    const r = store.leaveHuddle(CH, 'nobody');
    expect(r.before).toEqual([]);
    expect(r.after).toEqual([]);
    expect(r.workspaceId).toBeUndefined();
  });

  it('clearChannelHuddle wipes everyone at once (room_finished safety net)', () => {
    store.joinHuddle(CH, WS, 'u1', 1000);
    store.joinHuddle(CH, WS, 'u2', 2000);
    const cleared = store.clearChannelHuddle(CH);
    expect(cleared.before.map((p) => p.userId).sort()).toEqual(['u1', 'u2']);
    expect(cleared.workspaceId).toBe(WS);
    expect(store.huddleParticipants(CH)).toEqual([]);
  });

  it('reconcileChannel replaces the roster with what LiveKit actually reports', () => {
    store.joinHuddle(CH, WS, 'stale-user', 1000); // e.g. a leaver the webhook never told us about
    const r = store.reconcileChannel(CH, WS, [{ userId: 'u1', joinedAt: 3000 }]);
    expect(r.before.map((p) => p.userId)).toEqual(['stale-user']);
    expect(r.after).toEqual([{ userId: 'u1', joinedAt: 3000 }]);
  });

  it('reconcileChannel with an empty roster clears the channel', () => {
    store.joinHuddle(CH, WS, 'u1', 1000);
    store.reconcileChannel(CH, WS, []);
    expect(store.huddleParticipants(CH)).toEqual([]);
  });

  it('reports many channels at once, omitting the quiet ones', () => {
    store.joinHuddle('c1', WS, 'u1', 1000);
    const map = store.huddleParticipantsMany(['c1', 'c2']);
    expect(map.get('c1')).toEqual([{ userId: 'u1', joinedAt: 1000 }]);
    expect(map.has('c2')).toBe(false);
  });
});

describe('joinHuddle / leaveHuddle', () => {
  it('mints a token and publishes on the first join', async () => {
    const { token, url, inferenceToken } = await hd.joinHuddle(channelId, aliceId);
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3); // JWT
    expect(url).toBe(process.env.LIVEKIT_URL);
    expect(inferenceToken).toBeUndefined();
    expect(store.huddleParticipants(channelId).map((p) => p.userId)).toEqual([aliceId]);
  });

  it('mints a narrow, short-lived inference grant only when requested for an agent bridge', async () => {
    const { inferenceToken } = await hd.joinHuddle(channelId, aliceId, { includeInferenceToken: true });
    expect(inferenceToken?.split('.')).toHaveLength(3);
    const claims = JSON.parse(Buffer.from(inferenceToken!.split('.')[1]!, 'base64url').toString()) as {
      inference: { perform: boolean };
      video?: unknown;
      nbf: number;
      exp: number;
    };
    expect(claims.inference).toEqual({ perform: true });
    expect(claims.video).toBeUndefined();
    expect(claims.exp - claims.nbf).toBe(70 * 60);
  });

  it('is idempotent: rejoining succeeds without duplicating the roster entry', async () => {
    await hd.joinHuddle(channelId, aliceId);
    const second = await hd.joinHuddle(channelId, aliceId); // re-mints rather than erroring
    expect(second.token.split('.')).toHaveLength(3);
    expect(store.huddleParticipants(channelId).map((p) => p.userId)).toEqual([aliceId]);
  });

  it('allows a private channel the caller is a member of', async () => {
    const { token } = await hd.joinHuddle(privateId, bobId);
    expect(typeof token).toBe('string');
  });

  it('rejects a channel the caller cannot see', async () => {
    await expect(hd.joinHuddle(privateId, outsiderId)).rejects.toThrow(/not found/i);
  });

  it('grants camera and screen share, not just the microphone (#435)', async () => {
    const { token } = await hd.joinHuddle(channelId, aliceId);
    const claims = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()) as {
      video: { canPublishSources: string[] };
    };
    // The old grant was microphone-only, and LiveKit refuses an ungranted
    // source *silently* — the camera button would have looked fine and done
    // nothing.
    expect(claims.video.canPublishSources).toEqual([
      'microphone',
      'camera',
      'screen_share',
      'screen_share_audio',
    ]);
  });

  it('rejects an archived channel', async () => {
    await expect(hd.joinHuddle(archivedId, aliceId)).rejects.toThrow(/archived/i);
  });

  it('leaving removes the participant; leaving twice is a harmless no-op', async () => {
    await hd.joinHuddle(channelId, aliceId);
    await hd.leaveHuddle(channelId, aliceId);
    expect(store.huddleParticipants(channelId)).toEqual([]);
    await expect(hd.leaveHuddle(channelId, aliceId)).resolves.toBeUndefined();
  });

  it('leave still requires channel access', async () => {
    await expect(hd.leaveHuddle(privateId, outsiderId)).rejects.toThrow(/not found/i);
  });
});

describe('handleLiveKitWebhook', () => {
  it('participant_left drops that participant (disconnect safety net)', async () => {
    await hd.joinHuddle(channelId, aliceId);
    await hd.joinHuddle(channelId, bobId);
    const body = JSON.stringify({
      event: 'participant_left',
      room: { name: channelId },
      participant: { identity: aliceId },
    });
    await hd.handleLiveKitWebhook(body, await signWebhook(body));
    expect(store.huddleParticipants(channelId).map((p) => p.userId)).toEqual([bobId]);
  });

  it('room_finished clears the whole channel', async () => {
    await hd.joinHuddle(channelId, aliceId);
    await hd.joinHuddle(channelId, bobId);
    const body = JSON.stringify({ event: 'room_finished', room: { name: channelId } });
    await hd.handleLiveKitWebhook(body, await signWebhook(body));
    expect(store.huddleParticipants(channelId)).toEqual([]);
  });

  it('a bad signature is rejected and never mutates state', async () => {
    await hd.joinHuddle(channelId, aliceId);
    const body = JSON.stringify({
      event: 'participant_left',
      room: { name: channelId },
      participant: { identity: aliceId },
    });
    const forged = await signWebhook('{"event":"participant_left"}'); // signed over a different body
    await expect(hd.handleLiveKitWebhook(body, forged)).rejects.toThrow();
    expect(store.huddleParticipants(channelId).map((p) => p.userId)).toEqual([aliceId]);
  });

  it('participant_left for a room with no local record is a harmless no-op', async () => {
    const body = JSON.stringify({
      event: 'participant_left',
      room: { name: randomUUID() },
      participant: { identity: aliceId },
    });
    await expect(hd.handleLiveKitWebhook(body, await signWebhook(body))).resolves.toBeUndefined();
  });
});

// ---- DM huddle invites (#436) --------------------------------------------
// The ring is where channel huddles and DM huddles diverge, so these cover the
// lifecycle end to end: who can be rung, what each answer does, and the line
// the DM is left with. Presence is faked through the presence store (a "live
// socket" is what Track A means by reachable), and the ring timeout is 150ms
// here (FLOW_HUDDLE_RING_MS, set at the top of this file).
describe('DM huddle invites', () => {
  const online = (userId: string, connectionId = `c-${userId}`): void => {
    presence.registerConnection(connectionId, userId, [workspaceId]);
  };

  async function systemLines(channelId: string): Promise<{ kind: string | null; body: string }[]> {
    const { db, schema } = await import('../src/db/index.js');
    const { decryptBody } = await import('../src/crypto/index.js');
    const { eq, isNotNull, and } = await import('drizzle-orm');
    const rows = await db
      .select()
      .from(schema.messages)
      .where(and(eq(schema.messages.channelId, channelId), isNotNull(schema.messages.systemKind)));
    return rows.map((r) => ({
      kind: r.systemKind,
      body: decryptBody(r),
    }));
  }

  async function invitesFor(channelId: string) {
    const { db, schema } = await import('../src/db/index.js');
    const { eq } = await import('drizzle-orm');
    return db.select().from(schema.huddleInvites).where(eq(schema.huddleInvites.channelId, channelId));
  }

  async function targetsOf(inviteId: string) {
    const { db, schema } = await import('../src/db/index.js');
    const { eq } = await import('drizzle-orm');
    return db.select().from(schema.huddleInviteTargets).where(eq(schema.huddleInviteTargets.inviteId, inviteId));
  }

  it('starting a DM huddle rings a reachable callee', async () => {
    online(bobId);
    const res = await hd.joinHuddle(dmId, aliceId);
    expect(res.invite?.status).toBe('ringing');
    expect(res.unavailable).toEqual([]);
    expect(res.invite?.targets).toEqual([
      expect.objectContaining({ userId: bobId, status: 'ringing' }),
    ]);
    // The caller is in the room already, waiting — that is what makes accept instant.
    expect(store.huddleParticipants(dmId).map((p) => p.userId)).toEqual([aliceId]);
  });

  it('an offline callee is an instant miss, named to the caller', async () => {
    const res = await hd.joinHuddle(dmId, aliceId); // bob has no live socket
    expect(res.unavailable).toEqual(['Bob']);
    const [invite] = await invitesFor(dmId);
    expect(invite?.status).toBe('missed');
    expect(await systemLines(dmId)).toEqual([{ kind: 'huddle_missed', body: 'Missed huddle' }]);
  });

  it('DND suppresses the ring — reachable socket, unavailable person', async () => {
    online(bobId);
    const { db, schema } = await import('../src/db/index.js');
    const { eq } = await import('drizzle-orm');
    await db.update(schema.users).set({ statusSuppressAlerts: true }).where(eq(schema.users.id, bobId));
    const res = await hd.joinHuddle(dmId, aliceId);
    expect(res.unavailable).toEqual(['Bob']);
    expect(res.invite?.status).toBe('missed');
  });

  it('a muted DM suppresses the ring', async () => {
    online(bobId);
    await ch.setNotifyLevel(dmId, bobId, 0);
    try {
      const res = await hd.joinHuddle(dmId, aliceId);
      expect(res.unavailable).toEqual(['Bob']);
    } finally {
      await ch.setNotifyLevel(dmId, bobId, 1);
    }
  });

  it('accepting makes the call active and the accepter a participant', async () => {
    online(bobId);
    const started = await hd.joinHuddle(dmId, aliceId);
    const invite = await hi.acceptInvite(started.invite!.id, bobId, 'sess-phone');
    expect(invite).not.toBeNull();
    await hd.joinHuddle(dmId, bobId); // accept is join — routes chain these two
    const [row] = await invitesFor(dmId);
    expect(row?.status).toBe('active');
    expect(row?.answeredAt).not.toBeNull();
    expect((await targetsOf(row!.id))[0]?.status).toBe('accepted');
    expect(store.huddleParticipants(dmId).map((p) => p.userId).sort()).toEqual([aliceId, bobId].sort());
  });

  it('declining ends the ring and leaves "Call declined" in the DM', async () => {
    online(bobId);
    const started = await hd.joinHuddle(dmId, aliceId);
    await hi.declineInvite(started.invite!.id, bobId);
    const [row] = await invitesFor(dmId);
    expect(row?.status).toBe('declined');
    expect(await systemLines(dmId)).toEqual([{ kind: 'huddle_declined', body: 'Call declined' }]);
  });

  it('a ring nobody answers times out to missed', async () => {
    online(bobId);
    await hd.joinHuddle(dmId, aliceId);
    await new Promise((r) => setTimeout(r, 400));
    const [row] = await invitesFor(dmId);
    expect(row?.status).toBe('missed');
    expect((await targetsOf(row!.id))[0]?.status).toBe('missed');
    expect(await systemLines(dmId)).toEqual([{ kind: 'huddle_missed', body: 'Missed huddle' }]);
  });

  it('the caller backing out cancels the ring — the DM still reads "Missed huddle"', async () => {
    online(bobId);
    const started = await hd.joinHuddle(dmId, aliceId);
    await hi.cancelInvite(started.invite!.id, aliceId);
    const [row] = await invitesFor(dmId);
    // Recorded as cancelled; from Bob's side it was a call he never got to answer.
    expect(row?.status).toBe('cancelled');
    expect(await systemLines(dmId)).toEqual([{ kind: 'huddle_missed', body: 'Missed huddle' }]);
  });

  it('an answered call that empties ends with its duration', async () => {
    online(bobId);
    const started = await hd.joinHuddle(dmId, aliceId);
    await hi.acceptInvite(started.invite!.id, bobId);
    await hd.joinHuddle(dmId, bobId);
    await hd.leaveHuddle(dmId, bobId);
    await hd.leaveHuddle(dmId, aliceId); // room empty → call over
    const [row] = await invitesFor(dmId);
    expect(row?.status).toBe('ended');
    expect(row?.durationSeconds).not.toBeNull();
    const lines = await systemLines(dmId);
    expect(lines[0]?.kind).toBe('huddle_ended');
    expect(lines[0]?.body).toMatch(/^Call ended · \d+ (sec|min)$/);
  });

  it('a missed call marks the DM unread, unlike a join/leave line', async () => {
    await hd.joinHuddle(dmId, aliceId); // bob offline → instant miss
    const chans = await ch.listChannels(workspaceId, bobId);
    const dm = chans.find((c) => c.id === dmId);
    // The unread query excludes system messages by default (a join line
    // shouldn't bold a channel); huddle outcomes are the exception, because
    // "Missed huddle" is the only trace the call leaves.
    expect(dm?.unreadCount ?? 0).toBeGreaterThan(0);
  });

  it('the outcome line notifies the other member like any DM message', async () => {
    const { db, schema } = await import('../src/db/index.js');
    const { eq } = await import('drizzle-orm');
    await hd.joinHuddle(dmId, aliceId); // bob offline → instant miss
    const rows = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, bobId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe(1); // DM — unread + badge, same as a typed message
  });

  it('a callee busy in another DM huddle is unavailable', async () => {
    online(bobId);
    online(outsiderId);
    // Bob is mid-call in the group DM…
    store.joinHuddle(groupDmId, workspaceId, bobId);
    const res = await hd.joinHuddle(dmId, aliceId);
    expect(res.unavailable).toEqual(['Bob']);
  });

  it('a callee in a *channel* huddle still gets the ring', async () => {
    online(bobId);
    store.joinHuddle(channelId, workspaceId, bobId); // ambient, not a call
    const res = await hd.joinHuddle(dmId, aliceId);
    expect(res.unavailable).toEqual([]);
    expect(res.invite?.status).toBe('ringing');
  });

  it('a group DM goes active on the first accept and logs the non-answerer missed', async () => {
    online(bobId);
    online(outsiderId);
    const started = await hd.joinHuddle(groupDmId, aliceId);
    expect(started.invite?.targets).toHaveLength(2);
    await hi.acceptInvite(started.invite!.id, bobId);
    await hd.joinHuddle(groupDmId, bobId);
    let [row] = await invitesFor(groupDmId);
    expect(row?.status).toBe('active'); // first accept, while outsider keeps ringing
    expect((await targetsOf(row!.id)).find((t) => t.userId === outsiderId)?.status).toBe('ringing');

    await hd.leaveHuddle(groupDmId, bobId);
    await hd.leaveHuddle(groupDmId, aliceId);
    [row] = await invitesFor(groupDmId);
    expect(row?.status).toBe('ended');
    expect((await targetsOf(row!.id)).find((t) => t.userId === outsiderId)?.status).toBe('missed');
  });

  it('channel huddles stay ambient: no ring, no rows', async () => {
    online(bobId);
    const res = await hd.joinHuddle(channelId, aliceId);
    expect(res.invite).toBeNull();
    expect(res.unavailable).toEqual([]);
    expect(await invitesFor(channelId)).toHaveLength(0);
    expect(await systemLines(channelId)).toEqual([]);
  });

  it('the boot sweep retires rings orphaned by a restart', async () => {
    online(bobId);
    await hd.joinHuddle(dmId, aliceId);
    hi.resetHuddleInviteTimers(); // the old process died with its 30s timer
    expect(await hi.sweepStaleOnBoot()).toBe(1);
    const [row] = await invitesFor(dmId);
    expect(row?.status).toBe('missed');
  });
});
