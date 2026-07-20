#!/usr/bin/env node
// Socket Mode compat e2e: creates an app, connects the OFFICIAL
// @slack/socket-mode client to the local server, posts a message +
// @mention via the REST API, and asserts the events arrive over the
// socket (and are acked → outbox rows marked delivered).
// Requires the dev server running (dev email driver for autoVerify).
import { SocketModeClient } from '@slack/socket-mode';

const API = process.env.API ?? 'http://127.0.0.1:8787';
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
  if (res.status >= 400) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

// ---- setup: user, workspace, channel, app ----
const ts = Date.now();
const u = await api('POST', '/v1/auth/register', null, {
  email: `sockmode.${ts}@e2e.test`, password: 'password123', displayName: 'SockMode Admin', autoVerify: true,
});
const w = await api('POST', '/v1/workspaces', u.token, { name: `SockMode ${ts}`, slug: `sockmode-${ts}` });
const chans = await api('GET', `/v1/workspaces/${w.id}/channels`, u.token);
const general = (chans.channels ?? chans).find((c) => c.name === 'general');
const created = await api('POST', `/v1/workspaces/${w.id}/apps`, u.token, { name: 'SockBot' });
created.appToken?.startsWith('xapp-')
  ? ok('app creation returns xapp- app-level token')
  : bad('app token', JSON.stringify(Object.keys(created)));
await api('PATCH', `/v1/apps/${created.app.id}`, u.token, {
  eventTypes: ['message.channels', 'app_mention'],
});

// bot must be in the channel to receive channel events
const auth = await api('POST', '/api/auth.test', created.botToken);
await api('POST', '/api/conversations.join', created.botToken, { channel: general.id });

// ---- bad app token rejected ----
const badOpen = await api('POST', '/api/apps.connections.open', 'xapp-1-bogus');
badOpen.ok === false && badOpen.error === 'invalid_auth'
  ? ok('apps.connections.open rejects bad token')
  : bad('bad token', JSON.stringify(badOpen));

// ---- official SDK client connects ----
const received = [];
const client = new SocketModeClient({
  appToken: created.appToken,
  clientOptions: { slackApiUrl: `${API}/api/` },
});
// the SDK emits per Slack event type — register each subscribed type
const onEvent = async ({ event, body, ack }) => {
  received.push({ event, body });
  await ack();
};
client.on('message', onEvent);
client.on('app_mention', onEvent);

await client.start(); // resolves after hello
ok('official @slack/socket-mode client connected (hello received)');

// ---- post a message → message.channels over the socket ----
await api('POST', `/v1/channels/${general.id}/messages`, u.token, {
  clientMsgId: crypto.randomUUID(), body: 'hello socket world',
});
// ---- @mention the bot → app_mention ----
await api('POST', `/v1/channels/${general.id}/messages`, u.token, {
  clientMsgId: crypto.randomUUID(), body: `hey <@${auth.user_id}> ping`, mentions: [auth.user_id],
});

// outbox drains on an interval — poll up to 20s for both events
const deadline = Date.now() + 20_000;
while (Date.now() < deadline) {
  const types = received.map((r) => r.event?.type);
  if (types.includes('message') && types.includes('app_mention')) break;
  await new Promise((r) => setTimeout(r, 500));
}
const types = received.map((r) => r.event?.type);
types.includes('message')
  ? ok('message.channels delivered over socket')
  : bad('message event', JSON.stringify(types));
types.includes('app_mention')
  ? ok('app_mention delivered over socket')
  : bad('app_mention event', JSON.stringify(types));

const envelope = received[0]?.body;
envelope?.type === 'event_callback' && envelope?.api_app_id === created.app.id
  ? ok('event_callback envelope shape (api_app_id, type)')
  : bad('envelope shape', JSON.stringify(envelope)?.slice(0, 200));

// ---- acks marked delivered in the outbox (no retries hammering) ----
await new Promise((r) => setTimeout(r, 1_000));
const countBefore = received.length;
await new Promise((r) => setTimeout(r, 6_000)); // > first retry backoff (5s)
received.length === countBefore
  ? ok('acked envelopes are not redelivered')
  : bad('redelivery', `${countBefore} -> ${received.length}`);

// ---- bot replies via Web API over the same compat surface ----
const post = await api('POST', '/api/chat.postMessage', created.botToken, {
  channel: general.id, text: 'pong from socket-mode bot',
});
post.ok ? ok('bot chat.postMessage works') : bad('bot post', JSON.stringify(post));

await client.disconnect();
ok('client disconnected cleanly');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
