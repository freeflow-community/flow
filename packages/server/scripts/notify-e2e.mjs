#!/usr/bin/env node
// Notification end-to-end check (issue #63) — one assertion per bullet in the
// issue, over the real HTTP surface of a RUNNING server.
//
//   pnpm dev                      # in packages/server, or any deployed URL
//   node scripts/notify-e2e.mjs   # API=http://127.0.0.1:8787 by default
//
// Creates its own throwaway users and workspace on every run (never touches the
// qa-lab fixtures), so it is safe to run repeatedly against a dev database.
// Exits non-zero on the first failed expectation.
import { randomUUID } from 'node:crypto';

const API = process.env.API ?? 'http://127.0.0.1:8787';
const PASSWORD = 'password123';

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

const checks = [];
const check = (label, ok, detail = '') => {
  checks.push(ok);
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`);
};

const suffix = randomUUID().slice(0, 8);
const register = (who) =>
  api('POST', '/v1/auth/register', null, {
    email: `${who}-${suffix}@notify.test`,
    password: PASSWORD,
    displayName: who[0].toUpperCase() + who.slice(1),
    autoVerify: true,
  });

console.log(`\nnotification e2e against ${API}\n`);

const alice = await register('alice');
const bob = await register('bob');

const ws = await api('POST', '/v1/workspaces', alice.token, { name: 'Notify E2E', slug: `notify-${suffix}` });
const inv = await api('POST', `/v1/workspaces/${ws.id}/invites`, alice.token, { email: bob.user.email });
await api('POST', '/v1/invites/accept', bob.token, { token: inv.inviteUrl.split('/').pop() });

const chan = await api('POST', `/v1/workspaces/${ws.id}/channels`, alice.token, {
  name: `notify-${suffix}`,
  isPrivate: false,
});
await api('POST', `/v1/channels/${chan.id}/members`, alice.token, { userId: bob.user.id });

const send = (token, channelId, body, extra = {}) =>
  api('POST', `/v1/channels/${channelId}/messages`, token, { clientMsgId: randomUUID(), body, ...extra });
const inbox = (token) => api('GET', '/v1/me/notifications?limit=50', token);
const react = (token, messageId, emoji, remove = false) =>
  api(remove ? 'DELETE' : 'PUT', `/v1/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`, token);

// ---- what should NOT notify -------------------------------------
console.log('quiet by design');
await send(alice.token, chan.id, 'just chatter');
check('a plain channel message raises no notification', (await inbox(bob.token)).notifications.length === 0);

const selfDm = await api('POST', `/v1/workspaces/${ws.id}/dms`, bob.token, { userIds: [bob.user.id] });
const selfMsg = await send(bob.token, selfDm.id, 'note to self');
check(
  'your personal DM never notifies',
  !(await inbox(bob.token)).notifications.some((n) => n.messageId === selfMsg.id),
);

// ---- what should notify -----------------------------------------
console.log('\nnotifies');
const mention = await send(alice.token, chan.id, `hey <@${bob.user.id}>`, { mentions: [bob.user.id] });
check('@mention', (await inbox(bob.token)).notifications.some((n) => n.messageId === mention.id && n.kind === 0));

const dm = await api('POST', `/v1/workspaces/${ws.id}/dms`, alice.token, { userIds: [bob.user.id] });
const dmMsg = await send(alice.token, dm.id, 'psst');
check('direct message', (await inbox(bob.token)).notifications.some((n) => n.messageId === dmMsg.id && n.kind === 1));

const root = await send(bob.token, chan.id, 'thread root, by bob');
const reply = await send(alice.token, chan.id, 'replying', { threadRootId: root.id });
check('thread reply', (await inbox(bob.token)).notifications.some((n) => n.messageId === reply.id && n.kind === 2));

await react(alice.token, root.id, '🎉');
const rx = (await inbox(bob.token)).notifications.find((n) => n.kind === 4);
check('reaction on my message', !!rx);
check('  …names the reactor, not me', rx?.actorId === alice.user.id);
check('  …carries the emoji', rx?.reactionEmoji === '🎉', rx?.reactionEmoji);

await react(alice.token, root.id, '🎉', true);
await react(alice.token, root.id, '🎉');
check(
  'un-reacting and re-reacting stays one row',
  (await inbox(bob.token)).notifications.filter((n) => n.kind === 4).length === 1,
);

// ---- read state --------------------------------------------------
console.log('\nread state');
const before = await inbox(bob.token);
await api('POST', `/v1/channels/${chan.id}/read`, bob.token, { lastReadMsgId: root.id });
let page = await inbox(bob.token);
const row = (messageId) => page.notifications.find((n) => n.messageId === messageId);
check('visiting the channel reads its mention', row(mention.id)?.readAt !== null);
check('the thread reply stays unread (it is behind a click)', row(reply.id)?.readAt === null);
check('another channel keeps its unread', row(dmMsg.id)?.readAt === null);
check('unread count dropped', page.unreadCount < before.unreadCount, `${before.unreadCount} → ${page.unreadCount}`);

await api('POST', `/v1/channels/${chan.id}/read`, bob.token, { lastReadMsgId: root.id, threadRootId: root.id });
page = await inbox(bob.token);
check('opening the thread reads its reply', row(reply.id)?.readAt !== null);

const dmRow = row(dmMsg.id);
const res = await api('POST', '/v1/me/notifications/read', bob.token, { id: dmRow.id });
page = await inbox(bob.token);
check('reading one row leaves the rest alone', page.notifications.find((n) => n.id === dmRow.id)?.readAt !== null);
check('the read response returns the fresh count', res.unreadCount === page.unreadCount);
check('everything is read now', page.unreadCount === 0, `unread=${page.unreadCount}`);

const failed = checks.filter((ok) => !ok).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed\n`);
process.exit(failed === 0 ? 0 : 1);
