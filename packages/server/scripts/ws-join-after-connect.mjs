#!/usr/bin/env node
// Regression test: sockets that authenticate BEFORE joining/creating a workspace
// must still get live subscriptions for it (presence + message fan-out).
// Scenario: A connects → creates workspace → invites B; B connected since before
// accepting. Requires the server running.
import WebSocket from 'ws';

const API = process.env.API ?? 'http://127.0.0.1:8787';
const WS_URL = API.replace('http', 'ws') + '/v1/ws';
let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log('PASS:', n); };
const bad = (n, x) => { fail++; console.log('FAIL:', n, '--', x); };

async function api(method, path, token, body) {
  const res = await fetch(API + path, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

class Client {
  constructor(name) { this.name = name; this.frames = []; }
  connect(token) {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(WS_URL);
      this.ws.on('open', () => this.ws.send(JSON.stringify({ op: 'auth', token })));
      this.ws.on('message', (raw) => {
        const f = JSON.parse(String(raw));
        if (f.op === 'ping') { this.ws.send(JSON.stringify({ op: 'pong' })); return; }
        if (f.op === 'hello') { resolve(f); return; }
        this.frames.push(f);
      });
      this.ws.on('error', reject);
      setTimeout(() => reject(new Error(`${this.name}: hello timeout`)), 5000);
    });
  }
  waitEvent(pred, ms = 4000) {
    return new Promise((resolve, reject) => {
      const scan = () => this.frames.find((f) => f.op === 'event' && pred(f.event));
      const found = scan();
      if (found) return resolve(found.event);
      const iv = setInterval(() => {
        const f = scan();
        if (f) { clearInterval(iv); clearTimeout(to); resolve(f.event); }
      }, 25);
      const to = setTimeout(() => { clearInterval(iv); reject(new Error('event timeout')); }, ms);
    });
  }
  close() { this.ws?.close(); }
}

const uuid = () => crypto.randomUUID();
const run = uuid().slice(0, 8);

const a = await api('POST', '/v1/auth/register', null, {
  email: `join-a-${run}@test.local`, password: 'password-123', displayName: 'JoinA', autoVerify: true,
});
const b = await api('POST', '/v1/auth/register', null, {
  email: `join-b-${run}@test.local`, password: 'password-123', displayName: 'JoinB', autoVerify: true,
});

// Both connect BEFORE any workspace exists — the bug scenario.
const ca = new Client('A'); await ca.connect(a.token);
const cb = new Client('B'); await cb.connect(b.token);
ok('both sockets authed with zero workspaces');

// A creates a workspace while already connected.
const ws = await api('POST', '/v1/workspaces', a.token, { name: `Join ${run}`, slug: `join-${run}` });
try {
  const ev = await ca.waitEvent((e) => e.type === 'presence' && e.workspaceId === ws.id && e.data.userId === a.user.id && e.data.status === 'online');
  ok(`creator got own presence online in new workspace (${ev.data.status})`);
} catch (e) { bad('creator own presence after create', e.message); }

// A invites B; B accepts while connected.
const inv = await api('POST', `/v1/workspaces/${ws.id}/invites`, a.token, { email: `join-b-${run}@test.local` });
const invToken = inv.inviteUrl.split('/').pop();
await api('POST', '/v1/invites/accept', b.token, { token: invToken });

try {
  await cb.waitEvent((e) => e.type === 'presence' && e.workspaceId === ws.id && e.data.userId === a.user.id && e.data.status === 'online');
  ok('joiner got snapshot: A online');
} catch (e) { bad('joiner snapshot of A', e.message); }
try {
  await cb.waitEvent((e) => e.type === 'presence' && e.workspaceId === ws.id && e.data.userId === b.user.id && e.data.status === 'online');
  ok('joiner got own presence online');
} catch (e) { bad('joiner own presence', e.message); }
try {
  await ca.waitEvent((e) => e.type === 'presence' && e.workspaceId === ws.id && e.data.userId === b.user.id && e.data.status === 'online');
  ok('creator saw joiner come online');
} catch (e) { bad('creator sees joiner online', e.message); }

// Live fan-out into the post-connect workspace, both directions.
const chans = await api('GET', `/v1/workspaces/${ws.id}/channels`, a.token);
const general = chans.channels.find((c) => c.name === 'general');
await api('POST', `/v1/channels/${general.id}/messages`, a.token, { clientMsgId: uuid(), body: 'hello from A' });
try {
  await cb.waitEvent((e) => e.type === 'message.created' && e.channelId === general.id && e.data.body === 'hello from A');
  ok('joiner received live message from A');
} catch (e) { bad('joiner live fan-out', e.message); }
await api('POST', `/v1/channels/${general.id}/messages`, b.token, { clientMsgId: uuid(), body: 'hello from B' });
try {
  await ca.waitEvent((e) => e.type === 'message.created' && e.channelId === general.id && e.data.body === 'hello from B');
  ok('creator received live message from B');
} catch (e) { bad('creator live fan-out', e.message); }

// Offline propagates for the late-joined workspace too.
cb.close();
try {
  await ca.waitEvent((e) => e.type === 'presence' && e.workspaceId === ws.id && e.data.userId === b.user.id && e.data.status === 'offline');
  ok('creator saw joiner go offline');
} catch (e) { bad('creator sees joiner offline', e.message); }

ca.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
