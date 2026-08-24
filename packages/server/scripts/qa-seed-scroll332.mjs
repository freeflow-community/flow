#!/usr/bin/env node
// QA fixtures for #332 (iOS scroll-to-message). Run AFTER qa-seed.mjs.
//
// Creates `#scroll332`: a channel deep enough that a jump target sits far off
// screen, plus a thread deep enough that a jump inside it has somewhere to go.
//   - the channel jump target is an @mention of Alice, buried under 60
//     messages — far past a phone screen, but inside the transcript's first
//     window, so the test measures the scroll and not the history paging;
//   - the thread jump target is the FIRST reply, buried under 120 more, and is
//     *pinned* — on iOS the Activity feed deliberately doesn't jump into a
//     thread reply (see ActivityFeedView), so the pins sheet is the path that
//     drives ThreadScreen's focus.
//
// Idempotent: re-running reuses the channel and adds nothing if it's seeded.
//
// Usage: API=http://127.0.0.1:8787 node scripts/qa-seed-scroll332.mjs

import fs from 'node:fs/promises';

const API = process.env.API ?? 'http://127.0.0.1:8787';
const SEED = process.env.SEED_JSON ?? '/tmp/qa/seed.json';
const CHANNEL = process.env.CHANNEL ?? 'scroll332';
const CHANNEL_FILLER = 60;
const THREAD_FILLER = 120;

export const CHANNEL_TARGET = 'CHANNEL JUMP TARGET';
export const THREAD_TARGET = 'THREAD JUMP TARGET';

const seed = JSON.parse(await fs.readFile(SEED, 'utf8'));
const { alice, bob, workspaceId } = seed;

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

const send = (token, channelId, body, extra = {}) =>
  api('POST', `/v1/channels/${channelId}/messages`, token, {
    clientMsgId: crypto.randomUUID(),
    body,
    ...extra,
  });

const chans = await api('GET', `/v1/workspaces/${workspaceId}/channels`, alice.token);
let ch = chans.channels.find((c) => c.name === CHANNEL);
if (!ch) {
  ch = await api('POST', `/v1/workspaces/${workspaceId}/channels`, alice.token, {
    name: CHANNEL,
    isPrivate: false,
  });
  await api('POST', `/v1/channels/${ch.id}/join`, bob.token, {});
}

// A fresh channel already holds its "created the channel" system line, so the
// seeded check looks for the target itself rather than for any message at all.
const existing = await api('GET', `/v1/channels/${ch.id}/messages?limit=200`, alice.token);
if (existing.messages?.some((m) => m.body?.startsWith(CHANNEL_TARGET))) {
  console.log(JSON.stringify({ channelId: ch.id, note: 'already seeded' }, null, 2));
  process.exit(0);
}

// 1. Channel jump target, then a lot of history on top of it.
const chanTarget = await send(
  bob.token,
  ch.id,
  `${CHANNEL_TARGET} — hey <@${alice.userId}>, this is the row Activity has to land on.`,
  { mentions: [alice.userId] }
);
for (let i = 1; i <= CHANNEL_FILLER; i++) {
  await send(bob.token, ch.id, `channel filler ${i} of ${CHANNEL_FILLER}`);
}

// 2. A thread root, its jump target reply, then a deep tail of replies.
const root = await send(bob.token, ch.id, 'THREAD ROOT — open me (#332).');
const threadTarget = await send(bob.token, ch.id, `${THREAD_TARGET} — the reply the pins sheet has to land on.`, {
  threadRootId: root.id,
});
await api('PUT', `/v1/messages/${threadTarget.id}/pin`, alice.token, {});
for (let i = 1; i <= THREAD_FILLER; i++) {
  await send(bob.token, ch.id, `thread filler reply ${i} of ${THREAD_FILLER}`, { threadRootId: root.id });
}

console.log(
  JSON.stringify(
    {
      channelId: ch.id,
      channelName: CHANNEL,
      chanTargetId: chanTarget.id,
      rootId: root.id,
      threadTargetId: threadTarget.id,
    },
    null,
    2
  )
);
