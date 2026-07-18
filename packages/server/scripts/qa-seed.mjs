#!/usr/bin/env node
// QA seed: create two fresh accounts (alice, bob), a workspace owned by alice,
// and join bob via the invite flow — all over REST, in under a second.
// The UI run then starts at "sign in and converse" instead of spending
// ~15 interactions on registration and the invite dance.
//
// Usage: node scripts/qa-seed.mjs [runId]
// Prints a JSON blob with credentials, tokens, ids. Save it: > /tmp/qa/<runId>/seed.json

const API = process.env.API ?? 'http://127.0.0.1:8787';

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

const runId = process.argv[2] ?? crypto.randomUUID().slice(0, 8);
const password = 'qa-password-1';

const alice = await api('POST', '/v1/auth/register', null, {
  email: `alice-${runId}@qa.local`, password, displayName: 'Alice',
});
const bob = await api('POST', '/v1/auth/register', null, {
  email: `bob-${runId}@qa.local`, password, displayName: 'Bob',
});

const ws = await api('POST', '/v1/workspaces', alice.token, {
  name: `QA ${runId}`, slug: `qa-${runId}`,
});
const inv = await api('POST', `/v1/workspaces/${ws.id}/invites`, alice.token, {
  email: `bob-${runId}@qa.local`,
});
await api('POST', '/v1/invites/accept', bob.token, {
  token: inv.inviteUrl.split('/').pop(),
});

const chans = await api('GET', `/v1/workspaces/${ws.id}/channels`, alice.token);
const general = chans.channels.find((c) => c.name === 'general');

console.log(JSON.stringify({
  runId,
  api: API,
  password,
  alice: { email: alice.user.email, userId: alice.user.id, token: alice.token },
  bob: { email: bob.user.email, userId: bob.user.id, token: bob.token },
  workspaceId: ws.id,
  workspaceName: ws.name,
  generalChannelId: general?.id ?? null,
}, null, 2));
