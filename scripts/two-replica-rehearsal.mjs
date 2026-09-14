#!/usr/bin/env node
// Phase 18 dress rehearsal (M4 pre-flight): boot TWO server processes against
// the same Postgres + NATS — exactly what `replicas: 2` on Railway does — and
// verify the cross-replica behavior that single-process tests cannot:
//
//   1. M2 presence: a user whose only socket is on replica A shows online in
//      the connect-time snapshot handed out by replica B (after one gossip
//      heartbeat, 10s).
//   2. M3 tickets: a Socket Mode ticket minted by replica A redeems on a
//      WebSocket opened against replica B.
//   3. M3 routing: an event enqueued via replica A is delivered (and acked)
//      over the app socket held by replica B, whichever replica's outbox
//      drain claims it.
//
// Needs the dev docker cluster (packages/infra): postgres :5442, nats :4222.
// Uses a scratch database; safe to run repeatedly. Exit 0 = all checks pass.
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverDir = path.join(repo, 'packages', 'server');
// deps come from the server package — this script has no node_modules of its own
const requireFromServer = createRequire(path.join(serverDir, 'package.json'));
const WebSocket = requireFromServer('ws');

const DB = 'flow_two_replica_rehearsal';
const PORT_A = 8791;
const PORT_B = 8792;
const dataKey = randomBytes(32).toString('base64');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (msg) => console.log(`[rehearsal] ${msg}`);
let failures = 0;
function check(name, ok, detail = '') {
  if (ok) log(`PASS ${name}`);
  else {
    failures += 1;
    log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// ---- scratch database ------------------------------------------
const postgres = requireFromServer('postgres');
{
  const admin = postgres('postgres://flow:flow_dev@localhost:5442/postgres', { max: 1, onnotice: () => {} });
  await admin.unsafe(`DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`).catch(() => {});
  await admin.unsafe(`CREATE DATABASE "${DB}"`);
  await admin.end();
}

// ---- boot two replicas -----------------------------------------
// A busy port means a previous run's replica leaked — talking to it would
// test the wrong code against a freshly dropped database.
for (const port of [PORT_A, PORT_B]) {
  const busy = await fetch(`http://127.0.0.1:${port}/healthz`).then(() => true).catch(() => false);
  if (busy) {
    log(`FAIL port ${port} already serving — kill stale replicas first: pkill -f 'tsx src/index.ts'`);
    process.exit(1);
  }
}

function bootReplica(port) {
  // detached → own process group, so shutdown kills tsx and any child it
  // spawns (killing only the wrapper leaks the server — learned the hard way)
  const child = spawn(path.join(serverDir, 'node_modules', '.bin', 'tsx'), ['src/index.ts'], {
    cwd: serverDir,
    detached: true,
    env: {
      ...process.env,
      DATABASE_URL: `postgres://flow:flow_dev@localhost:5442/${DB}`,
      PORT: String(port),
      HOST: '127.0.0.1',
      FLOW_DATA_KEY: dataKey,
      FLOW_EMAIL_DRIVER: 'dev',
      NATS_URL: 'nats://127.0.0.1:4222',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', (d) => process.env.REHEARSAL_VERBOSE && console.error(`[:${port}] ${d}`));
  return child;
}

async function waitHealthy(port, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error(`replica :${port} never became healthy`);
}

log('booting replica A (:8791) and replica B (:8792) against one postgres + nats…');
const replA = bootReplica(PORT_A); // A boots first and runs the migrations (advisory-locked)
await waitHealthy(PORT_A);
const replB = bootReplica(PORT_B);
await waitHealthy(PORT_B);
log('both replicas healthy');

const A = `http://127.0.0.1:${PORT_A}`;
const B = `http://127.0.0.1:${PORT_B}`;

async function api(base, method, p, body, token) {
  const res = await fetch(`${base}${p}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${p} → ${res.status} ${JSON.stringify(json)}`);
  return json;
}

try {
  // ---- fixtures: two users, one workspace, one channel ----------
  const bobEmail = `bob-${randomUUID().slice(0, 8)}@rehearsal.test`;
  const u1 = await api(A, 'POST', '/v1/auth/register', {
    email: `alice-${randomUUID().slice(0, 8)}@rehearsal.test`,
    password: 'password123',
    displayName: 'Alice',
    autoVerify: true,
  });
  const u2 = await api(A, 'POST', '/v1/auth/register', {
    email: bobEmail,
    password: 'password123',
    displayName: 'Bob',
    autoVerify: true,
  });
  const wsp = await api(A, 'POST', '/v1/workspaces', { name: 'Rehearsal', slug: `rh-${randomUUID().slice(0, 8)}` }, u1.token);
  const invite = await api(A, 'POST', `/v1/workspaces/${wsp.id}/invites`, { email: bobEmail }, u1.token);
  const inviteToken = new URL(invite.inviteUrl).pathname.split('/').filter(Boolean).pop()
    ?? invite.inviteUrl.split('/').pop();
  await api(B, 'POST', '/v1/invites/accept', { token: inviteToken }, u2.token); // accept via B for good measure
  const chan = await api(A, 'POST', `/v1/workspaces/${wsp.id}/channels`, { name: `rehearsal-${randomUUID().slice(0, 8)}` }, u1.token);
  log(`fixtures ready (workspace ${wsp.id.slice(0, 8)}…)`);

  // ---- check 1: cross-replica presence snapshot (M2) ------------
  const wsA = new WebSocket(`ws://127.0.0.1:${PORT_A}/v1/ws`);
  await new Promise((resolve, reject) => {
    wsA.on('open', () => {
      wsA.send(JSON.stringify({ op: 'auth', token: u1.token }));
    });
    wsA.on('message', (raw) => {
      const f = JSON.parse(String(raw));
      if (f.op === 'hello') resolve();
    });
    wsA.on('error', reject);
    setTimeout(() => reject(new Error('wsA auth timeout')), 10_000);
  });
  log('alice connected to replica A; waiting 12s for one presence heartbeat…');
  await sleep(12_000);

  const presenceSeen = [];
  const wsB = new WebSocket(`ws://127.0.0.1:${PORT_B}/v1/ws`);
  await new Promise((resolve, reject) => {
    wsB.on('open', () => wsB.send(JSON.stringify({ op: 'auth', token: u2.token })));
    wsB.on('message', (raw) => {
      const f = JSON.parse(String(raw));
      if (f.op === 'event' && f.event?.type === 'presence') presenceSeen.push(f.event.data);
      if (f.op === 'hello') setTimeout(resolve, 1_500); // snapshot events follow hello
    });
    wsB.on('error', reject);
    setTimeout(() => reject(new Error('wsB auth timeout')), 10_000);
  });
  check(
    'M2: replica B connect snapshot shows the user whose socket is on replica A',
    presenceSeen.some((p) => p.userId === u1.user.id && p.status === 'online'),
    `snapshot events: ${JSON.stringify(presenceSeen)}`,
  );

  // ---- check 2+3: cross-replica Socket Mode (M3) ----------------
  const created = await api(A, 'POST', `/v1/workspaces/${wsp.id}/apps`, { name: 'RehearsalBot' }, u1.token);
  const appToken = created.appToken;
  const botUserId = created.app.botUserId;
  const createdAppId = created.app.id;
  // mint the ticket via replica A…
  const open = await api(A, 'POST', `/api/apps.connections.open?app_token=${encodeURIComponent(appToken)}`, {});
  if (!open.ok) throw new Error(`apps.connections.open failed: ${JSON.stringify(open)}`);
  // …but connect the socket to replica B (cross-replica redeem)
  const ticketUrl = new URL(open.url);
  const sockUrl = `ws://127.0.0.1:${PORT_B}/api/socket-mode${ticketUrl.search}`;
  const events = [];
  const appSock = new WebSocket(sockUrl);
  const gotHello = await new Promise((resolve) => {
    appSock.on('message', (raw) => {
      const f = JSON.parse(String(raw));
      if (f.type === 'hello') resolve(true);
      if (f.type === 'events_api') {
        events.push(f.payload?.event?.text);
        appSock.send(JSON.stringify({ envelope_id: f.envelope_id })); // ack
      }
    });
    appSock.on('close', () => resolve(false));
    appSock.on('error', () => resolve(false));
    setTimeout(() => resolve(false), 10_000);
  });
  check('M3: ticket minted on replica A redeems on replica B', gotHello);

  // subscribe the app to message events and add its bot to the channel
  await api(A, 'PATCH', `/v1/apps/${createdAppId}`, { eventTypes: ['message.channels'] }, u1.token);
  await api(A, 'POST', `/v1/channels/${chan.id}/members`, { userId: botUserId }, u1.token).catch(() => {});
  // event enqueued via replica A; drained by either replica; must reach B's socket
  await api(A, 'POST', `/v1/channels/${chan.id}/messages`, { clientMsgId: randomUUID(), body: 'hello across replicas' }, u1.token);
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && events.length === 0) await sleep(500);
  check(
    'M3: event enqueued on replica A delivered + acked over the socket held by replica B',
    events.some((t) => String(t).includes('hello across replicas')),
    `events seen: ${JSON.stringify(events)}`,
  );

  wsA.close();
  wsB.close();
  appSock.close();
} catch (err) {
  failures += 1;
  log(`FAIL rehearsal errored: ${err.message}`);
} finally {
  for (const child of [replA, replB]) {
    try {
      process.kill(-child.pid, 'SIGTERM'); // whole process group
    } catch {
      /* already gone */
    }
  }
  await sleep(500);
  for (const child of [replA, replB]) {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
}

log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
