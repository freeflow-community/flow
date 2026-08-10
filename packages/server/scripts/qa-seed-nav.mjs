#!/usr/bin/env node
// QA fixtures for the iOS navigation/scroll UI tests (run qa-seed.mjs first):
//   nav205a  — one threaded message (root + reply), topic set (ThreadNavTests)
//   nav205b  — one message "Hello from nav205b" (channel-switch target)
//   scroll209 — 40 numbered messages (ScrollBounceTests needs real back-scroll)
// Idempotent: channels are reused, and messages are only posted into a channel
// whose transcript is still empty.

const API = process.env.API ?? 'http://127.0.0.1:8787';
const PASSWORD = 'qa-password-1';

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

const alice = await api('POST', '/v1/auth/login', null, { email: 'alice@qa.local', password: PASSWORD });
const mine = await api('GET', '/v1/me/workspaces', alice.token);
const ws = mine.workspaces.find((w) => w.slug === 'qa-lab');
if (!ws) throw new Error('qa-lab workspace missing — run qa-seed.mjs first');
const chans = await api('GET', `/v1/workspaces/${ws.id}/channels`, alice.token);

async function ensureChannel(name) {
  const found = chans.channels.find((c) => c.name === name);
  if (found) return found;
  return api('POST', `/v1/workspaces/${ws.id}/channels`, alice.token, { name });
}

async function isEmpty(channelId) {
  const r = await api('GET', `/v1/channels/${channelId}/messages?limit=1`, alice.token);
  return (r.messages ?? []).length === 0;
}

async function post(channelId, body, threadRootId) {
  const r = await api('POST', `/v1/channels/${channelId}/messages`, alice.token, {
    body,
    clientMsgId: crypto.randomUUID(),
    ...(threadRootId ? { threadRootId } : {}),
  });
  return r.message?.id ?? r.id;
}

const navA = await ensureChannel('nav205a');
const navB = await ensureChannel('nav205b');
const scroll = await ensureChannel('scroll209');

if (await isEmpty(navA.id)) {
  const rootId = await post(navA.id, 'Thread-nav repro root');
  await post(navA.id, 'First reply', rootId);
  await api('PATCH', `/v1/channels/${navA.id}`, alice.token, {
    topic: 'A long enough topic to truncate on a phone screen',
  });
}
if (await isEmpty(navB.id)) {
  await post(navB.id, 'Hello from nav205b');
}
if (await isEmpty(scroll.id)) {
  for (let i = 1; i <= 40; i++) {
    await post(scroll.id, `scroll filler message ${i}`);
  }
}

console.log(JSON.stringify({ navA: navA.id, navB: navB.id, scroll: scroll.id }, null, 2));
