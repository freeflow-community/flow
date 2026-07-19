#!/usr/bin/env node
// QA fixtures: ensure the STABLE test accounts and workspace exist, and return
// fresh API tokens. Idempotent — safe to run before every test session (~1s).
//
// Stable fixtures (never per-run):
//   alice@qa.local / bob@qa.local, password qa-password-1, workspace slug qa-lab.
// Because fixtures are stable, the app only needs to sign in ONCE per profile —
// the Keychain keeps the session across relaunches, so test runs can assume a
// signed-in app. Fresh tokens issued here are additional sessions; they never
// invalidate the app's own session.
//
// Usage: node scripts/qa-seed.mjs > /tmp/qa/seed.json

const API = process.env.API ?? 'http://127.0.0.1:8787';
const PASSWORD = 'qa-password-1';
const SLUG = 'qa-lab';

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

async function ensureUser(email, displayName) {
  try {
    return await api('POST', '/v1/auth/login', null, { email, password: PASSWORD });
  } catch {
    return await api('POST', '/v1/auth/register', null, { email, password: PASSWORD, displayName, autoVerify: true });
  }
}

const alice = await ensureUser('alice@qa.local', 'Alice');
const bob = await ensureUser('bob@qa.local', 'Bob');
const scott = await ensureUser('scott@qa.local', 'Scott'); // human tester's account for interactive sessions

// workspace: reuse by slug, create if missing
const mine = await api('GET', '/v1/me/workspaces', alice.token);
let ws = mine.workspaces.find((w) => w.slug === SLUG);
if (!ws) ws = await api('POST', '/v1/workspaces', alice.token, { name: 'QA Lab', slug: SLUG });

// bob's and scott's memberships: invite + accept once
const members = await api('GET', `/v1/workspaces/${ws.id}/members`, alice.token);
for (const u of [bob, scott]) {
  if (!members.members.some((m) => m.userId === u.user.id)) {
    const inv = await api('POST', `/v1/workspaces/${ws.id}/invites`, alice.token, { email: u.user.email });
    await api('POST', '/v1/invites/accept', u.token, { token: inv.inviteUrl.split('/').pop() });
  }
}

const chans = await api('GET', `/v1/workspaces/${ws.id}/channels`, alice.token);
const general = chans.channels.find((c) => c.name === 'general');

console.log(JSON.stringify({
  api: API,
  password: PASSWORD,
  alice: { email: alice.user.email, userId: alice.user.id, token: alice.token },
  bob: { email: bob.user.email, userId: bob.user.id, token: bob.token },
  scott: { email: scott.user.email, userId: scott.user.id, token: scott.token },
  workspaceId: ws.id,
  workspaceName: ws.name,
  workspaceSlug: SLUG,
  generalChannelId: general?.id ?? null,
}, null, 2));
