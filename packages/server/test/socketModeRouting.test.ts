// Phase 18 M3: Socket Mode across replicas — DB-backed one-time tickets
// (mint on one replica, redeem on another) and envelope routing over NATS
// request/reply. DB-backed (scratch database on the dev postgres, port 5442);
// the routing block also needs a NATS server (docker compose in
// packages/infra, port 4222; present in CI) and skips itself when NATS is
// unreachable.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';

process.env.DATABASE_URL = process.env.FLOW_TEST_DATABASE_URL
  ?? 'postgres://flow:flow_dev@localhost:5442/flow_sockroute_test';
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
const sm = await import('../src/gateway/socketMode.js');
const bus = await import('../src/bus.js');
const auth = await import('../src/services/auth.js');
const ws = await import('../src/services/workspaces.js');
const { newId } = await import('../src/lib/ids.js');
const { eq } = await import('drizzle-orm');

const { apps, appSocketTickets } = schema;

let appId = '';

// The bus is optional: connect with a short timeout and let the routing
// block skip when no NATS is listening (a dev machine without docker).
let natsUp = false;
try {
  await Promise.race([
    bus.connectBus().then(() => {
      natsUp = true;
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('nats timeout')), 3_000)),
  ]);
} catch {
  natsUp = false;
}

beforeAll(async () => {
  await migrate(process.env.DATABASE_URL!);
  await db.execute(`TRUNCATE users, workspaces, sessions, invites, pending_signups RESTART IDENTITY CASCADE` as never);
  const reg = await auth.register('sockowner@example.test', {
    password: 'password123',
    displayName: 'Owner',
    autoVerify: true,
  });
  if (!('token' in reg)) throw new Error('expected autoVerify session');
  const w = await ws.createWorkspace(reg.user.id, 'Sock Test', `sock-${randomUUID().slice(0, 8)}`);
  appId = newId();
  await db.insert(apps).values({
    id: appId,
    workspaceId: w.id,
    name: 'sockapp',
    botUserId: reg.user.id,
    botTokenHash: randomBytes(32),
    createdBy: reg.user.id,
    signingSecret: 'shhh',
    appTokenHash: randomBytes(32),
    eventTypes: ['message.channels'],
  });
});

afterAll(async () => {
  await bus.closeBus().catch(() => {});
  await closeDb();
});

describe('DB-backed one-time tickets', () => {
  it('a ticket minted "on one replica" redeems exactly once "on another"', async () => {
    const ticket = await sm.mintSocketTicket(appId);
    // redeem knows nothing the database doesn't — that is the cross-replica claim
    expect(await sm.redeemSocketTicket(ticket)).toBe(appId);
    expect(await sm.redeemSocketTicket(ticket)).toBeNull(); // single-use
  });

  it('an expired ticket does not redeem, and minting sweeps it away', async () => {
    const ticket = await sm.mintSocketTicket(appId);
    await db
      .update(appSocketTickets)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(appSocketTickets.appId, appId));
    expect(await sm.redeemSocketTicket(ticket)).toBeNull();
    await sm.mintSocketTicket(appId); // opportunistic sweep runs here
    const rows = await db.select().from(appSocketTickets).where(eq(appSocketTickets.appId, appId));
    expect(rows.length).toBe(1); // only the fresh one survives
  });

  it('garbage never redeems', async () => {
    expect(await sm.redeemSocketTicket('not-a-ticket')).toBeNull();
  });
});

describe.skipIf(!natsUp)('envelope routing over NATS', () => {
  it('reports no_socket fast when no replica holds a socket', async () => {
    const result = await sm.deliverEnvelope(newId(), newId(), { type: 'message' }, 0);
    expect(result).toBe('no_socket');
  });

  it('routes to the replica that answers on the app subject and returns its ack', async () => {
    // Simulate the socket-holding replica: subscribe the same way
    // ensureRouteSub does and ack whatever arrives.
    const otherApp = newId();
    const sub = bus.subscribeBus(bus.subjectAppSocketMode(otherApp), { queue: 'socketmode' });
    const seen: unknown[] = [];
    void (async () => {
      for await (const m of sub) {
        seen.push(JSON.parse(new TextDecoder().decode(m.data)));
        m.respond(new TextEncoder().encode(JSON.stringify({ result: 'acked' })));
      }
    })();

    const envelopeId = newId();
    const result = await sm.deliverEnvelope(otherApp, envelopeId, { type: 'message', text: 'hi' }, 2);
    expect(result).toBe('acked');
    expect(seen).toEqual([{ envelopeId, payload: { type: 'message', text: 'hi' }, retryAttempt: 2 }]);
    sub.unsubscribe();
  });

  it("propagates the holding replica's timeout so the outbox retries", async () => {
    const otherApp = newId();
    const sub = bus.subscribeBus(bus.subjectAppSocketMode(otherApp), { queue: 'socketmode' });
    void (async () => {
      for await (const m of sub) {
        m.respond(new TextEncoder().encode(JSON.stringify({ result: 'timeout' })));
      }
    })();
    expect(await sm.deliverEnvelope(otherApp, newId(), { type: 'message' }, 0)).toBe('timeout');
    sub.unsubscribe();
  });
});
