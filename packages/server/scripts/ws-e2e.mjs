#!/usr/bin/env node
// WS gateway end-to-end test: two clients, message fan-out, typing, presence,
// private-channel filtering, heartbeat ping/pong.
// Requires the server running (optionally with FLOW_HEARTBEAT_MS=2000 to
// exercise the heartbeat quickly).
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
  constructor(name) { this.name = name; this.frames = []; this.pings = 0; }
  connect(token) {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(WS_URL);
      this.ws.on('open', () => this.ws.send(JSON.stringify({ op: 'auth', token })));
      this.ws.on('message', (raw) => {
        const f = JSON.parse(String(raw));
        if (f.op === 'ping') { this.pings++; this.ws.send(JSON.stringify({ op: 'pong' })); return; }
        if (f.op === 'hello') { resolve(f); return; }
        this.frames.push(f);
      });
      this.ws.on('error', reject);
      setTimeout(() => reject(new Error(`${this.name}: hello timeout`)), 5000);
    });
  }
  send(frame) { this.ws.send(JSON.stringify(frame)); }
  /** wait until an event matching pred arrives (scans buffer + future) */
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
  async expectNoEvent(pred, ms = 1500) {
    await new Promise((r) => setTimeout(r, ms));
    return !this.frames.some((f) => f.op === 'event' && pred(f.event));
  }
  close() { this.ws.close(); }
}

const ts = Date.now();
const uuid = () => crypto.randomUUID();

// ---- setup over REST ----
const a = await api('POST', '/v1/auth/register', null, { email: `wsa.${ts}@x.com`, password: 'password123', displayName: 'WsAlice' });
const b = await api('POST', '/v1/auth/register', null, { email: `wsb.${ts}@x.com`, password: 'password123', displayName: 'WsBob' });
const w = await api('POST', '/v1/workspaces', a.token, { name: `WsTest ${ts}`, slug: `wstest-${ts}` });
const inv = await api('POST', `/v1/workspaces/${w.id}/invites`, a.token, { email: `wsb.${ts}@x.com` });
await api('POST', '/v1/invites/accept', b.token, { token: inv.inviteUrl.split('/').pop() });
const chans = await api('GET', `/v1/workspaces/${w.id}/channels`, a.token);
const general = chans.channels.find((c) => c.name === 'general');

// ---- connect both clients ----
const ca = new Client('alice');
const cb = new Client('bob');
const helloA = await ca.connect(a.token);
helloA.sessionId ? ok('alice ws auth -> hello{sessionId}') : bad('hello alice', JSON.stringify(helloA));
const helloB = await cb.connect(b.token);
helloB.sessionId ? ok('bob ws auth -> hello{sessionId}') : bad('hello bob', JSON.stringify(helloB));

// presence: bob should see alice online (snapshot or live event)
try {
  await cb.waitEvent((e) => e.type === 'presence' && e.data.userId === a.user.id && e.data.status === 'online');
  ok('bob sees alice presence online');
} catch { bad('presence online', 'not received'); }

// ---- message fan-out ----
const cmid = uuid();
const sent = await api('POST', `/v1/channels/${general.id}/messages`, a.token, { clientMsgId: cmid, body: 'realtime hello' });
try {
  const evB = await cb.waitEvent((e) => e.type === 'message.created' && e.data.id === sent.id);
  evB.data.body === 'realtime hello' ? ok('bob receives message.created with plaintext body') : bad('fanout body', JSON.stringify(evB.data));
} catch { bad('fanout to bob', 'timeout'); }
try {
  const evA = await ca.waitEvent((e) => e.type === 'message.created' && e.data.clientMsgId === cmid);
  ok('sender echo carries clientMsgId for reconcile');
} catch { bad('sender echo', 'timeout'); }

// ---- thread reply event ----
const reply = await api('POST', `/v1/channels/${general.id}/messages`, b.token, { clientMsgId: uuid(), body: 'a reply', threadRootId: sent.id });
try {
  await ca.waitEvent((e) => e.type === 'thread.reply' && e.data.id === reply.id);
  ok('thread.reply event fans out');
} catch { bad('thread.reply', 'timeout'); }

// ---- edit + delete events ----
await api('PATCH', `/v1/messages/${sent.id}`, a.token, { body: 'edited!' });
try {
  await cb.waitEvent((e) => e.type === 'message.updated' && e.data.id === sent.id && e.data.body === 'edited!');
  ok('message.updated event');
} catch { bad('message.updated', 'timeout'); }
await api('DELETE', `/v1/messages/${reply.id}`, b.token);
try {
  await ca.waitEvent((e) => e.type === 'message.deleted' && e.data.id === reply.id);
  ok('message.deleted event');
} catch { bad('message.deleted', 'timeout'); }

// ---- typing ----
cb.send({ op: 'typing', channelId: general.id });
try {
  const t = await ca.waitEvent((e) => e.type === 'typing' && e.data.userId === b.user.id && e.channelId === general.id);
  ok('typing indicator fans out');
} catch { bad('typing', 'timeout'); }

// ---- private channel filtering ----
const priv = await api('POST', `/v1/workspaces/${w.id}/channels`, a.token, { name: 'ws-private', isPrivate: true });
const pmsg = await api('POST', `/v1/channels/${priv.id}/messages`, a.token, { clientMsgId: uuid(), body: 'secret stuff' });
try {
  await ca.waitEvent((e) => e.type === 'message.created' && e.data.id === pmsg.id);
  ok('creator receives private-channel message');
} catch { bad('private to creator', 'timeout'); }
(await cb.expectNoEvent((e) => e.channelId === priv.id))
  ? ok('non-member receives nothing for private channel')
  : bad('private filter', 'bob got a private-channel event');

// ---- meta: channel.created fan-out for public channels ----
const pub = await api('POST', `/v1/workspaces/${w.id}/channels`, a.token, { name: 'ws-public' });
try {
  await cb.waitEvent((e) => e.type === 'channel.created' && e.data.id === pub.id);
  ok('channel.created meta event');
} catch { bad('channel.created', 'timeout'); }

// ---- heartbeat ----
const hb = Number(process.env.EXPECT_HEARTBEAT_MS ?? 0);
if (hb > 0) {
  await new Promise((r) => setTimeout(r, hb * 2.5));
  ca.pings > 0 ? ok(`heartbeat ping received (${ca.pings})`) : bad('heartbeat', 'no pings');
}

// ---- presence offline on disconnect ----
cb.close();
try {
  await ca.waitEvent((e) => e.type === 'presence' && e.data.userId === b.user.id && e.data.status === 'offline');
  ok('presence offline on disconnect');
} catch { bad('presence offline', 'timeout'); }

ca.close();
console.log(`\n=== WS E2E: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
