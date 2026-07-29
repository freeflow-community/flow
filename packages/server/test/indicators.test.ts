// Channel activity indicators (#137): the transient in-memory store (aggregate
// across setters, TTL expiry, the sweeper, clear-on-disconnect) and the service
// on top of it (authorization, private-channel isolation, the channel-list
// overlay, and publishing only on real aggregate changes).
//
// The store half is pure and needs no database; the service half does, so this
// uses the same scratch-database setup as the other service tests (docker
// compose in packages/infra, host port 5442).
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATABASE_URL = process.env.FLOW_TEST_DATABASE_URL
  ?? 'postgres://flow:flow_dev@localhost:5442/flow_indicators_test';
process.env.FLOW_DATA_KEY = randomBytes(32).toString('base64');
process.env.FLOW_FILE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-indicators-test-'));
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
const ind = await import('../src/indicators.js');
const ci = await import('../src/services/channelIndicators.js');
const { eq } = await import('drizzle-orm');

const { users, workspaceMembers } = schema;

let aliceId = '';
let agentId = '';
let outsiderId = ''; // workspace member, not in `channelId`
let workspaceId = '';
let channelId = '';
let privateId = ''; // private channel: alice only

async function registerHuman(email: string, name: string): Promise<string> {
  const res = await auth.register(email, { password: 'password123', displayName: name, autoVerify: true });
  if (!('token' in res)) throw new Error('expected autoVerify session');
  return res.user.id;
}

beforeAll(async () => {
  await migrate(process.env.DATABASE_URL!);
  await db.execute(`TRUNCATE users, workspaces, sessions, invites, pending_signups RESTART IDENTITY CASCADE` as never);
  aliceId = await registerHuman('alice@example.test', 'Alice');
  agentId = await registerHuman('robo@example.test', 'Robo');
  outsiderId = await registerHuman('outsider@example.test', 'Outsider');
  await db.update(users).set({ isAgent: true }).where(eq(users.id, agentId));

  const w = await ws.createWorkspace(aliceId, 'Indicators Test', `ind-${randomUUID().slice(0, 8)}`);
  workspaceId = w.id;
  for (const uid of [agentId, outsiderId]) {
    await db.insert(workspaceMembers).values({ workspaceId, userId: uid, role: 'member' });
  }
  const chan = await ch.createChannel(workspaceId, aliceId, 'work');
  channelId = chan.id;
  await ch.addMember(channelId, aliceId, agentId);

  const priv = await ch.createChannel(workspaceId, aliceId, 'secret', undefined, true);
  privateId = priv.id;
});

afterAll(async () => {
  await closeDb();
  fs.rmSync(process.env.FLOW_FILE_DIR!, { recursive: true, force: true });
});

beforeEach(() => {
  ind.resetIndicators();
});

describe('indicator store', () => {
  const CH = 'chan-1';
  const WS = 'ws-1';

  it('reports nothing for a channel no one is working in', () => {
    expect(ind.channelIndicator(CH)).toBeNull();
  });

  it('turns on for a setter and reports the aggregate transition', () => {
    const r = ind.setIndicator(CH, WS, 'u1', 'busy');
    expect(r.before).toBeNull();
    expect(r.after).toBe('busy');
    expect(ind.channelIndicator(CH)).toBe('busy');
  });

  it('a refresh is not an aggregate change (so it publishes nothing)', () => {
    ind.setIndicator(CH, WS, 'u1', 'busy');
    const again = ind.setIndicator(CH, WS, 'u1', 'busy');
    expect(again.before).toBe('busy');
    expect(again.after).toBe('busy');
  });

  it('keeps spinning while a second agent is still working', () => {
    ind.setIndicator(CH, WS, 'u1', 'busy');
    ind.setIndicator(CH, WS, 'u2', 'busy');
    const cleared = ind.clearIndicator(CH, 'u1');
    expect(cleared.after).toBe('busy'); // u2 still there
    expect(ind.clearIndicator(CH, 'u2').after).toBeNull();
  });

  it('clearing an indicator nobody set is a no-op', () => {
    const r = ind.clearIndicator(CH, 'nobody');
    expect(r.before).toBeNull();
    expect(r.after).toBeNull();
  });

  it('expires on its own — a crashed setter cannot spin forever', () => {
    const t0 = 1_000_000;
    ind.setIndicator(CH, WS, 'u1', 'busy', 30_000, t0);
    expect(ind.channelIndicator(CH, t0 + 29_000)).toBe('busy');
    expect(ind.channelIndicator(CH, t0 + 30_000)).toBeNull();
  });

  it('a refresh extends the expiry', () => {
    const t0 = 1_000_000;
    ind.setIndicator(CH, WS, 'u1', 'busy', 30_000, t0);
    ind.setIndicator(CH, WS, 'u1', 'busy', 30_000, t0 + 20_000);
    expect(ind.channelIndicator(CH, t0 + 40_000)).toBe('busy');
  });

  it('the sweep reports channels that just went quiet, once', () => {
    const t0 = 1_000_000;
    ind.setIndicator(CH, WS, 'u1', 'busy', 30_000, t0);
    expect(ind.sweepExpired(t0 + 10_000)).toEqual([]);
    expect(ind.sweepExpired(t0 + 40_000)).toEqual([{ channelId: CH, workspaceId: WS }]);
    expect(ind.sweepExpired(t0 + 50_000)).toEqual([]); // already gone
  });

  it('a sweep keeps a channel where another setter is still live', () => {
    const t0 = 1_000_000;
    ind.setIndicator(CH, WS, 'u1', 'busy', 30_000, t0);
    ind.setIndicator(CH, WS, 'u2', 'busy', 120_000, t0);
    expect(ind.sweepExpired(t0 + 40_000)).toEqual([]);
    expect(ind.channelIndicator(CH, t0 + 40_000)).toBe('busy');
  });

  it('disconnect drops every channel that setter was spinning', () => {
    ind.setIndicator('c1', WS, 'u1', 'busy');
    ind.setIndicator('c2', WS, 'u1', 'busy');
    ind.setIndicator('c3', WS, 'u2', 'busy');
    const cleared = ind.clearIndicatorsForUser('u1');
    expect(cleared.map((c) => c.channelId).sort()).toEqual(['c1', 'c2']);
    expect(ind.channelIndicator('c3')).toBe('busy'); // someone else's, untouched
  });

  it('disconnect reports only channels that actually went quiet', () => {
    ind.setIndicator('c1', WS, 'u1', 'busy');
    ind.setIndicator('c1', WS, 'u2', 'busy'); // u2 keeps c1 spinning
    expect(ind.clearIndicatorsForUser('u1')).toEqual([]);
    expect(ind.channelIndicator('c1')).toBe('busy');
  });

  it('reports many channels at once, omitting the quiet ones', () => {
    ind.setIndicator('c1', WS, 'u1', 'busy');
    const map = ind.channelIndicators(['c1', 'c2']);
    expect(map.get('c1')).toBe('busy');
    expect(map.has('c2')).toBe(false);
  });
});

describe('setChannelIndicator', () => {
  it('turns the channel spinner on and back off', async () => {
    expect(await ci.setChannelIndicator(channelId, agentId, 'busy')).toEqual({ state: 'busy' });
    expect(ind.channelIndicator(channelId)).toBe('busy');
    expect(await ci.setChannelIndicator(channelId, agentId, 'none')).toEqual({ state: null });
    expect(ind.channelIndicator(channelId)).toBeNull();
  });

  it('honours a caller-supplied ttl', async () => {
    const before = Date.now();
    await ci.setChannelIndicator(channelId, agentId, 'busy', 5);
    expect(ind.channelIndicator(channelId, before + 4_000)).toBe('busy');
    expect(ind.channelIndicator(channelId, before + 6_000)).toBeNull();
  });

  it('rejects a channel the caller cannot see', async () => {
    await expect(ci.setChannelIndicator(privateId, outsiderId, 'busy')).rejects.toThrow(/not found/i);
    expect(ind.channelIndicator(privateId)).toBeNull();
  });

  it('rejects an unknown channel', async () => {
    await expect(ci.setChannelIndicator(randomUUID(), agentId, 'busy')).rejects.toThrow(/not found/i);
  });

  it('shows up on the channel list, and disappears when cleared', async () => {
    await ci.setChannelIndicator(channelId, agentId, 'busy');
    const listed = (await ch.listChannels(workspaceId, aliceId)).find((c) => c.id === channelId);
    expect(listed?.indicator).toBe('busy');

    await ci.setChannelIndicator(channelId, agentId, 'none');
    const after = (await ch.listChannels(workspaceId, aliceId)).find((c) => c.id === channelId);
    expect(after?.indicator ?? null).toBeNull();
  });

  it('clears on disconnect', async () => {
    await ci.setChannelIndicator(channelId, agentId, 'busy');
    ci.clearIndicatorsOnDisconnect(agentId);
    expect(ind.channelIndicator(channelId)).toBeNull();
  });
});
