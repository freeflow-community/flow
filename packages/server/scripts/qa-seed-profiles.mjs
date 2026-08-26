#!/usr/bin/env node
// QA fixtures for the member profile card (#223). Run after qa-seed.mjs.
//
// Creates `#profiles223` in the QA Lab workspace and puts in it exactly what
// the card needs to be tested: a message from someone with a website and a bio,
// a message from someone with neither, and a thread. The profiles are set here
// rather than by hand because the card's whole job is showing them.
//
// Usage: node scripts/qa-seed-profiles.mjs
//        API=http://127.0.0.1:8799 node scripts/qa-seed-profiles.mjs

const API = process.env.API ?? 'http://127.0.0.1:8787';
const PASSWORD = 'qa-password-1';
const SLUG = 'qa-lab';
const CHANNEL = process.env.CHANNEL ?? 'profiles223';

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

// The send route wants a client-side id for de-duplication.
const post = (token, body, threadRootId) =>
  api('POST', `/v1/channels/${channel.id}/messages`, token, {
    body,
    clientMsgId: crypto.randomUUID(),
    ...(threadRootId ? { threadRootId } : {}),
  });

const login = (email) => api('POST', '/v1/auth/login', null, { email, password: PASSWORD });

const alice = await login('alice@qa.local');
const bob = await login('bob@qa.local');

// Bob is the filled-in profile the card is tested against; Alice is the empty
// one, so both states exist in the same channel.
await api('PATCH', '/v1/me', bob.token, {
  website: 'https://example.com/bob',
  bio: 'Bassist. Keeps the QA fixtures honest.\nSecond line, so the card proves it keeps newlines.',
});
await api('PATCH', '/v1/me', alice.token, { website: '', bio: '' });

const mine = await api('GET', '/v1/me/workspaces', alice.token);
const ws = mine.workspaces.find((w) => w.slug === SLUG);
if (!ws) throw new Error(`no ${SLUG} workspace — run qa-seed.mjs first`);

const chans = await api('GET', `/v1/workspaces/${ws.id}/channels`, alice.token);
let channel = chans.channels.find((c) => c.name === CHANNEL);
if (!channel) {
  channel = await api('POST', `/v1/workspaces/${ws.id}/channels`, alice.token, { name: CHANNEL });
}
// Bob has to be in the channel to post in it.
const members = await api('GET', `/v1/channels/${channel.id}/members`, alice.token).catch(() => ({ members: [] }));
if (!members.members?.some((m) => m.userId === bob.user.id)) {
  await api('POST', `/v1/channels/${channel.id}/members`, alice.token, { userId: bob.user.id });
}

// Idempotent by body, not by count: a freshly created channel already holds a
// "joined the channel" system line, and each fixture is checked on its own so a
// half-finished earlier run completes rather than being read as done.
const existing = await api('GET', `/v1/channels/${channel.id}/messages?limit=50`, alice.token);
const has = (prefix) => existing.messages?.some((m) => m.body?.startsWith(prefix)) ?? false;

if (!has('Alice here')) {
  await post(alice.token, 'Alice here, with no website and no bio — the empty card.');
}
let root = existing.messages?.find((m) => m.body?.startsWith('Bob here'));
if (!root) {
  root = await post(bob.token, 'Bob here, with both fields set — the full card, and the root of the thread.');
}
if (!has('A reply,')) {
  await post(bob.token, 'A reply, so the thread screen has something to show.', root.id);
}

console.log(JSON.stringify({
  api: API,
  channel: CHANNEL,
  channelId: channel.id,
  workspaceId: ws.id,
  alice: { userId: alice.user.id, displayName: alice.user.displayName },
  bob: { userId: bob.user.id, displayName: bob.user.displayName, website: 'https://example.com/bob' },
}, null, 2));
