#!/usr/bin/env node
// QA fixtures for the iOS row-identity / scroll-target tests (#332). Run
// qa-seed.mjs first — this reuses its Alice and the qa-lab workspace.
//
//   jump332   — 60 messages ("Message N of 60"), with "Message 20 of 60" pinned.
//               40 rows above the newest message: far enough back that a channel
//               opened at the end cannot see it, so a jump either lands or
//               visibly doesn't — but still inside the first 50-message page, so
//               the test measures the scroll rather than the backfill.
//   thread332 — one root with 30 replies ("Reply N of 30"), with "Reply 3 of 30"
//               pinned. Pinned thread replies are the only way into
//               ThreadScreen's focus path from the UI (the Activity feed
//               deliberately doesn't jump into one — see ActivityFeedView), and
//               30 replies is more than a phone screen holds.
//
// Idempotent: channels are reused, and messages are only posted into a channel
// whose transcript is still empty.
//
// Usage: API=http://127.0.0.1:8787 node scripts/qa-seed-scroll332.mjs

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

const pin = (id) => api('PUT', `/v1/messages/${id}/pin`, alice.token, {});

const jump = await ensureChannel('jump332');
const thread = await ensureChannel('thread332');

if (await isEmpty(jump.id)) {
  for (let i = 1; i <= 60; i++) {
    const id = await post(jump.id, `Message ${i} of 60`);
    if (i === 20) await pin(id);
  }
}

if (await isEmpty(thread.id)) {
  const rootId = await post(thread.id, 'Thread root for 332');
  for (let i = 1; i <= 30; i++) {
    const id = await post(thread.id, `Reply ${i} of 30`, rootId);
    if (i === 3) await pin(id);
  }
}

console.log(JSON.stringify({ jump: jump.id, thread: thread.id }, null, 2));
