#!/usr/bin/env node
// End-to-end bridge check against a LOCAL dev server (AGENTS_DESIGN QA):
//   1. registers a human owner + workspace, mints an agent invite
//   2. registers a scratch agent via /v1/agents/register
//   3. starts the bridge with the fake stream-json runtime
//   4. DM round-trip: thinking status appears/edits → final reply, status deleted
//   5. session continuity (--resume), /reset (fresh --session-id)
//   6. thread continuity (separate session per thread, history context)
//   7. loop guard: the agent's own replies trigger nothing
//
// Usage: node scripts/e2e.mjs   (FLOW_E2E_SERVER overrides the server URL)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const SERVER = (process.env.FLOW_E2E_SERVER ?? 'http://127.0.0.1:8899').replace(/\/+$/, '');
const here = path.dirname(fileURLToPath(import.meta.url));
const THINKING = '🤖 *thinking…*';

let failures = 0;
const ok = (cond, label) => {
  console.log(`${cond ? '  ✓' : '  ✗ FAIL'} ${label}`);
  if (!cond) failures += 1;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(token, method, p, body) {
  const res = await fetch(`${SERVER}${p}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status}: ${await res.text()}`);
  return res.json();
}

// ---- setup: humans, workspace, agent ----------------------------
console.log('setup:');
const suffix = Date.now();
const owner = await api(null, 'POST', '/v1/auth/register', {
  email: `e2e-owner-${suffix}@example.test`,
  password: 'password123',
  displayName: 'E2E Owner',
  autoVerify: true,
});
const ws = await api(owner.token, 'POST', '/v1/workspaces', { name: 'Bridge E2E', slug: `bridge-e2e-${suffix}` });
const invite = await api(owner.token, 'POST', `/v1/workspaces/${ws.id}/agent-invites`, { nameHint: 'E2EBot' });
ok(invite.key.startsWith('flow-agent-'), 'agent invite key minted (flow-agent-…)');
const reg = await api(null, 'POST', '/v1/agents/register', { inviteKey: invite.key, name: 'E2EBot' });
ok(reg.agentToken.startsWith('flow-agent-token-'), 'agent registered, token returned once');
ok(reg.user.isAgent === true, 'registered user has isAgent=true');
const agentId = reg.user.id;

// replay must fail
const replay = await fetch(`${SERVER}/v1/agents/register`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ inviteKey: invite.key, name: 'ReplayBot' }),
});
ok(replay.status === 401, 'invite replay rejected (401)');

// ---- bridge with fake runtime -----------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-e2e-'));
const cfgPath = path.join(tmp, 'agent.json');
fs.writeFileSync(
  cfgPath,
  JSON.stringify({
    serverUrl: SERVER,
    agentToken: reg.agentToken,
    runtime: {
      kind: 'claude',
      command: path.join(here, 'fake-runtime.mjs'),
      cwd: tmp,
      mcp: false,
      timeoutSec: 30,
    },
    progress: 'thinking',
  }),
);
const bridgeEntry = path.join(here, '..', 'dist', 'index.js');
const bridge = spawn(process.execPath, [bridgeEntry, 'run', cfgPath], { stdio: ['ignore', 'pipe', 'pipe'] });
bridge.stdout.on('data', (d) => process.env.E2E_VERBOSE && process.stdout.write(`[bridge] ${d}`));
bridge.stderr.on('data', (d) => process.stdout.write(`[bridge err] ${d}`));
await sleep(1500); // let it connect

// ---- DM round-trip ----------------------------------------------
console.log('dm round-trip:');
const dm = await api(owner.token, 'POST', `/v1/workspaces/${ws.id}/dms`, { userIds: [agentId] });

async function listBodies() {
  const page = await api(owner.token, 'GET', `/v1/channels/${dm.id}/messages?limit=100`);
  return page.messages.filter((m) => !m.deletedAt);
}

async function listAll(threadRootId) {
  let msgs = await listBodies();
  if (threadRootId) {
    const t = await api(owner.token, 'GET', `/v1/messages/${threadRootId}/thread?limit=100`);
    msgs = msgs.concat(t.messages.filter((m) => !m.deletedAt));
  }
  return msgs;
}

async function sendAndCollect(body, { expectThinking = true, threadRootId } = {}) {
  const beforeIds = new Set((await listAll(threadRootId)).map((m) => m.id));
  await api(owner.token, 'POST', `/v1/channels/${dm.id}/messages`, {
    clientMsgId: randomUUID(),
    body,
    ...(threadRootId ? { threadRootId } : {}),
  });
  let sawThinking = false;
  let thinkingBodies = new Set();
  let reply = null;
  for (let i = 0; i < 100; i += 1) {
    await sleep(300);
    const msgs = await listAll(threadRootId);
    for (const m of msgs) {
      if (m.userId !== agentId || beforeIds.has(m.id)) continue;
      if (m.body.startsWith(THINKING)) {
        sawThinking = true;
        thinkingBodies.add(m.body);
      } else {
        reply = m;
      }
    }
    if (reply) break;
  }
  await sleep(800); // allow status deletion to land
  const finalMsgs = await listAll(threadRootId);
  const thinkingLeft = finalMsgs.some((m) => m.body.startsWith(THINKING));
  if (expectThinking) {
    ok(sawThinking, 'thinking status message appeared');
    ok(thinkingBodies.size >= 2, `status message edited in place (${thinkingBodies.size} distinct step bodies)`);
  }
  ok(!thinkingLeft, 'status message deleted after completion');
  ok(reply !== null, 'final reply posted');
  return reply;
}

const r1 = await sendAndCollect('hello agent');
const m1 = r1?.body.match(/mode=(\w+) sid=([\w-]+) hist=(\w+)/);
ok(m1?.[1] === 'new', 'first turn used --session-id (new session)');
ok(m1?.[3] === 'false', 'no stale history injected on empty DM');
ok(r1?.body.includes('hello agent'), 'prompt delivered to runtime');

console.log('session continuity:');
const r2 = await sendAndCollect('second message');
const m2 = r2?.body.match(/mode=(\w+) sid=([\w-]+)/);
ok(m2?.[1] === 'resume', 'second turn used --resume');
ok(m2?.[2] === m1?.[2], 'same session id across turns');

console.log('/reset:');
{
  const before = new Set((await listBodies()).map((m) => m.id));
  await api(owner.token, 'POST', `/v1/channels/${dm.id}/messages`, { clientMsgId: randomUUID(), body: '/reset' });
  let confirmed = false;
  for (let i = 0; i < 30 && !confirmed; i += 1) {
    await sleep(300);
    confirmed = (await listBodies()).some(
      (m) => m.userId === agentId && !before.has(m.id) && m.body.includes('context reset'),
    );
  }
  ok(confirmed, 'reset confirmation posted');
}
const r3 = await sendAndCollect('after reset');
const m3 = r3?.body.match(/mode=(\w+) sid=([\w-]+) hist=(\w+)/);
ok(m3?.[1] === 'new', 'post-reset turn started a fresh session (--session-id)');
ok(m3?.[2] !== m1?.[2], 'fresh session id after /reset');
ok(m3?.[3] === 'true', 'new session got recent-history context');

console.log('thread continuity:');
const rootId = r1.id; // thread under the agent's first reply
const t1 = await sendAndCollect('thread question', { threadRootId: rootId });
const tm1 = t1?.body.match(/mode=(\w+) sid=([\w-]+)/);
ok(t1?.threadRootId === rootId, 'reply landed in the same thread');
ok(tm1?.[1] === 'new', 'thread got its own session');
ok(tm1?.[2] !== m3?.[2], 'thread session id differs from DM session');
const t2 = await sendAndCollect('thread follow-up', { threadRootId: rootId });
const tm2 = t2?.body.match(/mode=(\w+) sid=([\w-]+)/);
ok(tm2?.[1] === 'resume' && tm2?.[2] === tm1?.[2], 'thread session resumed on follow-up');

console.log('loop guard:');
{
  const count = (await listBodies()).length;
  await sleep(4000); // if the agent reacted to its own replies, more would appear
  const after = (await listBodies()).length;
  ok(after === count, `no self-triggered runs (message count stable at ${after})`);
}

bridge.kill('SIGTERM');
fs.rmSync(tmp, { recursive: true, force: true });
console.log(failures === 0 ? '\nE2E PASS' : `\nE2E FAIL (${failures} failed checks)`);
process.exit(failures === 0 ? 0 : 1);
