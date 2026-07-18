#!/usr/bin/env node
// Phase-2 WS event verification: reaction events, per-user notification
// delivery (incl. <!here> online-only fan-out), user.updated, member.left,
// and DM fan-out. Requires the server running.
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
  async expectNoEvent(pred, ms = 1500) {
    await new Promise((r) => setTimeout(r, ms));
    return !this.frames.some((f) => f.op === 'event' && pred(f.event));
  }
  close() { this.ws?.close(); }
}

const TS = Date.now();
const uuid = () => crypto.randomUUID();

// setup: alice (owner) + bob + carol in one workspace
const users = {};
for (const n of ['alice', 'bob', 'carol']) {
  users[n] = await api('POST', '/v1/auth/register', null, {
    email: `${n}.${TS}@ws2.test`, password: 'password123', displayName: `${n} ws2`,
  });
}
const A = users.alice, B = users.bob, C = users.carol;
const ws = await api('POST', '/v1/workspaces', A.token, { name: `ws2 ${TS}`, slug: `ws2-${TS}` });
for (const u of [B, C]) {
  const inv = await api('POST', `/v1/workspaces/${ws.id}/invites`, A.token, { email: u.user.email });
  await api('POST', '/v1/invites/accept', u.token, { token: inv.inviteUrl.split('/').pop() });
}
const chans = await api('GET', `/v1/workspaces/${ws.id}/channels`, A.token);
const general = chans.channels.find((c) => c.name === 'general');

const ca = new Client('alice'); await ca.connect(A.token);
const cb = new Client('bob'); await cb.connect(B.token);
// carol stays OFFLINE (no socket) for the <!here> test

// ---- DM creation + fan-out --------------------------------------
const dm = await api('POST', `/v1/workspaces/${ws.id}/dms`, A.token, { userIds: [B.user.id] });
try {
  await cb.waitEvent((e) => e.type === 'member.joined' && e.channelId === dm.id && e.data.userId === B.user.id);
  ok('DM creation: member.joined reached the other member');
} catch (e) { bad('DM member.joined', e.message); }

const dmMsg = await api('POST', `/v1/channels/${dm.id}/messages`, A.token, { clientMsgId: uuid(), body: 'dm ws test' });
try {
  await cb.waitEvent((e) => e.type === 'message.created' && e.data.id === dmMsg.id);
  ok('DM message fan-out to member');
} catch (e) { bad('DM fan-out', e.message); }
try {
  const n = await cb.waitEvent((e) => e.type === 'notification.created' && e.data.messageId === dmMsg.id);
  if (n.data.kind === 1 && n.data.message.body === 'dm ws test') ok('notification.created (kind=1) on per-user subject');
  else bad('dm notification payload', JSON.stringify(n.data));
} catch (e) { bad('dm notification event', e.message); }

// ---- reactions --------------------------------------------------
const m1 = await api('POST', `/v1/channels/${general.id}/messages`, A.token, { clientMsgId: uuid(), body: 'react ws' });
await api('PUT', `/v1/messages/${m1.id}/reactions/${encodeURIComponent('🎉')}`, B.token);
try {
  const e = await ca.waitEvent((e) => e.type === 'reaction.added' && e.data.messageId === m1.id);
  if (e.data.emoji === '🎉' && e.data.userId === B.user.id) ok('reaction.added event');
  else bad('reaction.added payload', JSON.stringify(e.data));
} catch (e) { bad('reaction.added', e.message); }
await api('DELETE', `/v1/messages/${m1.id}/reactions/${encodeURIComponent('🎉')}`, B.token);
try {
  await ca.waitEvent((e) => e.type === 'reaction.removed' && e.data.messageId === m1.id);
  ok('reaction.removed event');
} catch (e) { bad('reaction.removed', e.message); }

// ---- mention notification targets only the mentioned user -------
const m2 = await api('POST', `/v1/channels/${general.id}/messages`, A.token, {
  clientMsgId: uuid(), body: `hi <@${B.user.id}>`, mentions: [B.user.id],
});
try {
  const n = await cb.waitEvent((e) => e.type === 'notification.created' && e.data.messageId === m2.id);
  if (n.data.kind === 0) ok('mention notification.created (kind=0) to target');
  else bad('mention kind', JSON.stringify(n.data));
} catch (e) { bad('mention notification', e.message); }
if (await ca.expectNoEvent((e) => e.type === 'notification.created' && e.data.messageId === m2.id)) {
  ok('sender gets no notification');
} else bad('sender notification leak', 'alice received her own mention notification');

// ---- <!here> hits online members only ---------------------------
const m3 = await api('POST', `/v1/channels/${general.id}/messages`, A.token, {
  clientMsgId: uuid(), body: '<!here> quick sync',
});
try {
  await cb.waitEvent((e) => e.type === 'notification.created' && e.data.messageId === m3.id);
  ok('<!here> notifies online member (bob)');
} catch (e) { bad('here online', e.message); }
const carolNotifs = await api('GET', '/v1/me/notifications?limit=10', C.token);
if (!carolNotifs.notifications.some((n) => n.messageId === m3.id)) ok('<!here> skips offline member (carol)');
else bad('here offline', 'carol (offline) was notified by <!here>');
// ...but <!channel> does reach carol's store for later
const m4 = await api('POST', `/v1/channels/${general.id}/messages`, A.token, {
  clientMsgId: uuid(), body: '<!channel> all hands',
});
const carolNotifs2 = await api('GET', '/v1/me/notifications?limit=10', C.token);
if (carolNotifs2.notifications.some((n) => n.messageId === m4.id)) ok('<!channel> reaches offline member store');
else bad('channel offline', JSON.stringify(carolNotifs2));

// ---- user.updated on profile change -----------------------------
await api('PATCH', '/v1/me', B.token, { displayName: 'Bobby WS2' });
try {
  const e = await ca.waitEvent((e) => e.type === 'user.updated' && e.data.id === B.user.id);
  if (e.data.displayName === 'Bobby WS2') ok('user.updated broadcast to co-members');
  else bad('user.updated payload', JSON.stringify(e.data));
} catch (e) { bad('user.updated', e.message); }

// ---- member.left ------------------------------------------------
const chan = await api('POST', `/v1/workspaces/${ws.id}/channels`, A.token, { name: `wsp2-${TS}` });
await api('POST', `/v1/channels/${chan.id}/join`, B.token);
await api('POST', `/v1/channels/${chan.id}/leave`, B.token);
try {
  const e = await ca.waitEvent((e) => e.type === 'member.left' && e.channelId === chan.id);
  if (e.data.userId === B.user.id) ok('member.left event');
  else bad('member.left payload', JSON.stringify(e.data));
} catch (e) { bad('member.left', e.message); }

// ---- channel.archived -------------------------------------------
await api('POST', `/v1/channels/${chan.id}/archive`, A.token);
try {
  await cb.waitEvent((e) => e.type === 'channel.archived' && e.channelId === chan.id);
  ok('channel.archived event');
} catch (e) { bad('channel.archived', e.message); }

ca.close(); cb.close();
console.log(`\n=== WS PHASE2: ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
