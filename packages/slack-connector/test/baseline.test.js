// Public-API baseline routes (#545): read, mutations, capability gating,
// shared rate budgets, and Events API routing per grant. The fake Slack keeps
// live-shaped replies (see decision_log 2026-09-11: trust live over docs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHmac } from 'node:crypto';
import { Store } from '../src/store.js';
import { Connector, hash, opaque } from '../src/connector.js';
import { requestedScopes, requestedEvents, grantedCapabilities } from '../src/manifest.js';
import { normalizeMessage, normalizeEvent, isDegraded, emojiFromName, tsToIso } from '../src/normalize.js';
import { createConnectorServer } from '../src/http.js';

const TS1 = '1789171841.148649', TS2 = '1789171890.271539', TS3 = '1789172009.709539';
const slackMessage = (ts, extra = {}) => ({ type: 'message', user: 'U1', ts, text: 'hello *world* &amp; <@U2>', client_msg_id: `cm-${ts}`, team: 'T1', blocks: [{ type: 'rich_text', block_id: 'x', elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text: 'hello world' }] }] }], ...extra });

function fixture(t, options = {}) {
  const store = new Store(':memory:', randomBytes(32).toString('base64'));
  t.after(() => store.close());
  let now = 1_800_000_000_000;
  const calls = [];
  const state = { rateLimitNext: 0 };
  const fetcher = async (url, request) => {
    const method = url.split('/').pop();
    const params = Object.fromEntries(new URLSearchParams(request.body));
    calls.push({ method, params });
    if (options.fetcher) { const override = await options.fetcher(method, params, request, state); if (override) return override instanceof Response ? override : new Response(JSON.stringify(override)); }
    let result;
    switch (method) {
      case 'oauth.v2.access': result = { ok: true, app_id: 'A1', team: { id: 'T1', name: 'Team T1' }, authed_user: { id: 'U1', token_type: 'user', access_token: 'secret-T1', refresh_token: 'refresh-T1', expires_in: 43200, scope: (options.scopes ?? requestedScopes).join(',') } }; break;
      case 'auth.test': result = { ok: true, user_id: 'U1', user: 'alice', team_id: 'T1' }; break;
      case 'users.conversations': result = { ok: true, channels: [
        { id: 'C1', name: 'testing', is_channel: true, is_member: true, is_private: false, created: 1789170000, creator: 'U1', topic: { value: 'topic' } },
        { id: 'D1', is_im: true, user: 'U2', created: 1789170001 },
        { id: 'G1', name: 'mpdm-alice--bob--carol-1', is_mpim: true, is_private: true, created: 1789170002 },
      ], response_metadata: { next_cursor: '' } }; break;
      case 'users.list': result = { ok: true, members: [
        { id: 'U1', name: 'alice', real_name: 'Alice A', is_admin: true, profile: { display_name: 'alice', email: 'a@example.test', image_72: 'https://avatars.test/a.png', status_emoji: ':tada:', status_text: 'yay' } },
        { id: 'U2', name: 'bob', real_name: 'Bob', profile: {} },
        { id: 'U3', name: 'gone', deleted: true, profile: {} },
        { id: 'USLACKBOT', name: 'slackbot', profile: {} },
      ], response_metadata: { next_cursor: '' } }; break;
      case 'conversations.history': {
        if (state.rateLimitNext > 0) { state.rateLimitNext--; return new Response('{"ok":false,"error":"ratelimited"}', { status: 429, headers: { 'retry-after': '60' } }); }
        const page = params.cursor === 'older' ? [slackMessage('1789170000.000001')] : [slackMessage(TS3, { thread_ts: TS1 }), slackMessage(TS2, { edited: { user: 'U1', ts: '1789172065.000000' } }), slackMessage(TS1, { reply_count: 1, reply_users: ['U1'], latest_reply: TS3, reactions: [{ name: 'white_check_mark', users: ['U1'], count: 1 }], files: [{ id: 'F1', name: 'a.txt', mimetype: 'text/plain', size: 30, created: 1789172215, user: 'U1' }] })];
        result = { ok: true, messages: page, has_more: params.cursor !== 'older', response_metadata: { next_cursor: params.cursor === 'older' ? '' : 'older' } }; break;
      }
      case 'conversations.replies': result = params.ts === TS1 ? { ok: true, messages: [slackMessage(TS1, { thread_ts: TS1, reply_count: 1 }), slackMessage(TS3, { thread_ts: TS1, parent_user_id: 'U1' })], has_more: false } : { ok: false, error: 'thread_not_found' }; break;
      case 'chat.postMessage': result = { ok: true, channel: params.channel, ts: '1700000000.000001', message: { user: 'U1', bot_id: 'B9', app_id: 'A1', bot_profile: { id: 'B9' } } }; break;
      case 'chat.update': result = params.ts === TS2 ? { ok: true, channel: params.channel, ts: params.ts, text: params.text, message: { user: 'U1', type: 'message', edited: { user: 'U1', ts: '1789172065.000000' }, text: params.text, blocks: [], client_msg_id: 'cm-2' } } : { ok: false, error: 'cant_update_message' }; break;
      case 'chat.delete': result = params.ts === TS2 ? { ok: true, channel: params.channel, ts: params.ts } : { ok: false, error: 'message_not_found' }; break;
      case 'reactions.add': result = params.name === 'eyes' ? { ok: false, error: 'already_reacted' } : { ok: true }; break;
      case 'reactions.remove': result = { ok: true }; break;
      case 'conversations.mark': result = { ok: true }; break;
      case 'search.messages': result = { ok: true, messages: { matches: [{ ...slackMessage(TS1), channel: { id: 'C1' } }], pagination: { next_cursor: '' } } }; break;
      default: throw new Error(`Unexpected method ${method}`);
    }
    return new Response(JSON.stringify(result));
  };
  const connector = new Connector({ store, clientId: '123.456', clientSecret: 'client-secret', publicOrigin: 'https://connector.test', clientOrigins: ['https://flow.test'], signingSecret: 'signing-secret', fetcher, now: () => now });
  async function connect() {
    const verifier = opaque();
    const start = connector.start({ challenge: hash(verifier), clientOrigin: 'https://flow.test' });
    const callback = await connector.callback({ state: new URL(start.authorizationUrl).searchParams.get('state'), code: 'T1' });
    return connector.exchange({ ...callback, verifier });
  }
  const event = (value, envelopeExtra = {}, eventId = opaque()) => {
    const timestamp = String(Math.floor(now / 1000));
    const raw = Buffer.from(JSON.stringify({ type: 'event_callback', event_id: eventId, team_id: 'T1', api_app_id: 'A1', authorizations: [{ user_id: 'U1', team_id: 'T1', is_bot: false }], event: value, ...envelopeExtra }));
    const signature = `v0=${createHmac('sha256', 'signing-secret').update(`v0:${timestamp}:`).update(raw).digest('hex')}`;
    return connector.event(raw, timestamp, signature);
  };
  return { connector, store, calls, connect, event, state, advance: ms => { now += ms; } };
}

test('normalizer keeps ts verbatim, converts mrkdwn, maps reactions/files/threads, flags degraded blocks', () => {
  const m = normalizeMessage(slackMessage(TS1, { thread_ts: TS1, reply_count: 2, reply_users: ['U1', 'U2'], latest_reply: TS3, reactions: [{ name: 'white_check_mark', users: ['U1'] }], files: [{ id: 'F1', name: 'a.txt', mimetype: 'text/plain', size: 30, created: 1789172215 }] }), { teamId: 'T1', channelId: 'C1' });
  assert.equal(m.id, TS1);
  assert.equal(m.threadRootId, null, 'a root whose thread_ts equals its ts is not a reply');
  assert.equal(m.body, 'hello **world** & <@U2>');
  assert.equal(m.createdAt, tsToIso(TS1));
  assert.deepEqual(m.reactions, [{ emoji: '✅', count: 1, userIds: ['U1'] }]);
  assert.equal(m.files[0].name, 'a.txt');
  assert.equal(m.replyCount, 2);
  assert.deepEqual(m.replyParticipantUserIds, ['U1', 'U2']);
  assert.equal(m.provenance.openUrl, `https://app.slack.com/client/T1/C1/p${TS1.replace('.', '')}`);
  assert.equal(m.provenance.degraded, false);
  const reply = normalizeMessage(slackMessage(TS3, { thread_ts: TS1 }), { teamId: 'T1', channelId: 'C1' });
  assert.equal(reply.threadRootId, TS1);
  assert.equal(isDegraded({ blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'x' } }] }), true);
  assert.equal(isDegraded({ attachments: [{ fallback: 'x' }] }), true);
  assert.equal(isDegraded(slackMessage(TS1)), false);
  assert.equal(emojiFromName('white_check_mark::skin-tone-2'), '✅');
  assert.equal(emojiFromName('some_custom_emoji'), ':some_custom_emoji:');
  assert.throws(() => normalizeMessage({ ts: 1789171841.148649, text: 'x' }, { teamId: 'T1', channelId: 'C1' }), /ts/);
});

test('events normalize to the shared stream shapes', () => {
  assert.equal(normalizeEvent(slackMessage(TS1, { channel: 'C1' }), { teamId: 'T1' }).type, 'message.created');
  assert.equal(normalizeEvent(slackMessage(TS3, { channel: 'C1', thread_ts: TS1 }), { teamId: 'T1' }).type, 'thread.reply');
  const changed = normalizeEvent({ type: 'message', subtype: 'message_changed', channel: 'C1', hidden: true, message: slackMessage(TS2, { edited: { user: 'U1', ts: '1789172065.000000' } }), previous_message: slackMessage(TS2) }, { teamId: 'T1' });
  assert.equal(changed.type, 'message.updated');
  assert.equal(changed.message.editedAt, tsToIso('1789172065.000000'));
  const deleted = normalizeEvent({ type: 'message', subtype: 'message_deleted', channel: 'C1', hidden: true, deleted_ts: TS3, previous_message: slackMessage(TS3, { thread_ts: TS1 }) }, { teamId: 'T1' });
  assert.deepEqual(deleted, { type: 'message.deleted', channelId: 'C1', messageId: TS3, threadRootId: TS1 });
  assert.deepEqual(normalizeEvent({ type: 'reaction_added', user: 'U1', reaction: 'eyes', item: { type: 'message', channel: 'C1', ts: TS1 } }, { teamId: 'T1' }), { type: 'reaction.added', channelId: 'C1', messageId: TS1, emoji: '👀', userId: 'U1' });
  assert.equal(normalizeEvent({ type: 'message', subtype: 'message_replied', message: slackMessage(TS1) }, { teamId: 'T1' }), null);
  assert.equal(normalizeEvent({ type: 'user_typing' }, { teamId: 'T1' }), null);
});

test('manifest: optional capabilities stay out of the authorize URL and read as not granted', () => {
  assert.ok(!requestedScopes.includes('reactions:write'));
  assert.ok(!requestedScopes.includes('search:read'));
  assert.ok(requestedScopes.includes('channels:history'));
  assert.deepEqual(requestedEvents.sort(), ['app_uninstalled', 'message.channels', 'message.groups', 'message.im', 'message.mpim', 'tokens_revoked']);
  const granted = grantedCapabilities(requestedScopes);
  assert.equal(granted.readHistory, true);
  assert.equal(granted.liveUpdates, true);
  assert.equal(granted.reactions, false);
  assert.equal(granted.readState, false);
});

test('read routes: workspace, conversations, members, history pages, thread replies', async t => {
  const f = fixture(t);
  const { credential } = await f.connect();
  const workspace = await f.connector.workspace(credential);
  assert.deepEqual([workspace.id, workspace.name], ['T1', 'Team T1']);
  const conversations = await f.connector.conversations(credential);
  assert.deepEqual(conversations.map(c => [c.id, c.kind, c.name, c.isPrivate]), [['C1', 'standard', 'testing', false], ['D1', 'dm', null, true], ['G1', 'group_dm', null, true]]);
  assert.deepEqual(conversations[1].memberIds, ['U2', 'U1']);
  assert.deepEqual(conversations[2].memberIds, ['U1', 'U2'], 'group DM handles resolve to ids (carol is unknown and dropped)');
  assert.equal(conversations[0].provenance.openUrl, 'https://app.slack.com/client/T1/C1');
  const members = await f.connector.members(credential);
  assert.deepEqual(members.map(m => [m.userId, m.displayName, m.role, m.isBot]), [['U1', 'alice', 'admin', false], ['U2', 'Bob', 'member', false], ['USLACKBOT', 'slackbot', 'member', true]]);
  assert.equal(members[0].statusEmoji, '🎉');
  assert.ok(!('deleted' in members[0]));
  const page = await f.connector.history(credential, { channel: 'C1', cursor: null, limit: 50 });
  assert.deepEqual(page.messages.map(m => m.id), [TS1, TS2, TS3], 'oldest first');
  assert.equal(page.cursor, 'older');
  assert.equal(page.partial, true, 'a short page with more behind it is partial');
  assert.equal(f.calls.find(c => c.method === 'conversations.history').params.limit, '50');
  const older = await f.connector.history(credential, { channel: 'C1', cursor: 'older', limit: 50 });
  assert.equal(older.cursor, null);
  assert.equal(older.partial, false);
  const thread = await f.connector.replies(credential, { channel: 'C1', ts: TS1 });
  assert.equal(thread.root.id, TS1);
  assert.deepEqual(thread.replies.map(r => [r.id, r.threadRootId]), [[TS3, TS1]]);
  await assert.rejects(f.connector.replies(credential, { channel: 'C1', ts: TS2 }), /not_found/);
  await assert.rejects(f.connector.history(credential, { channel: 'c1', cursor: null, limit: 5 }), /invalid_request/);
  await assert.rejects(f.connector.history(credential, { channel: 'C1', cursor: 'bad cursor!', limit: 5 }), /invalid_request/);
  await assert.rejects(f.connector.history(opaque(), { channel: 'C1', cursor: null, limit: 5 }), /unauthorized/);
});

test('rate budget is shared per team and method, answers locally while parked, and honors Retry-After', async t => {
  const f = fixture(t);
  const a = await f.connect();
  const b = await f.connect();
  f.state.rateLimitNext = 1;
  await assert.rejects(f.connector.history(a.credential, { channel: 'C1', cursor: null, limit: 15 }), error => error.code === 'rate_limited' && error.retryAfter === 60);
  const before = f.calls.length;
  await assert.rejects(f.connector.history(b.credential, { channel: 'C1', cursor: null, limit: 15 }), error => error.code === 'rate_limited' && error.retryAfter === 60);
  assert.equal(f.calls.length, before, 'the second session did not spend a call while the budget was parked');
  await f.connector.replies(a.credential, { channel: 'C1', ts: TS1 }); // a different method has its own budget
  f.advance(61_000);
  const page = await f.connector.history(b.credential, { channel: 'C1', cursor: null, limit: 15 });
  assert.equal(page.messages.length, 3);
});

test('mutations: edit and delete map Slack errors; reactions/read/search are unavailable without the scope', async t => {
  const f = fixture(t);
  const { credential } = await f.connect();
  const edited = await f.connector.update(credential, { channel: 'C1', ts: TS2, text: 'now **bold**' });
  assert.equal(edited.id, TS2);
  assert.equal(edited.body, 'now **bold**');
  assert.equal(f.calls.find(c => c.method === 'chat.update').params.text, 'now *bold*', 'markdown goes out as mrkdwn');
  await assert.rejects(f.connector.update(credential, { channel: 'C1', ts: TS1, text: 'x' }), error => error.code === 'forbidden' && error.status === 403);
  assert.deepEqual(await f.connector.remove(credential, { channel: 'C1', ts: TS2 }), { ok: true });
  await assert.rejects(f.connector.remove(credential, { channel: 'C1', ts: TS1 }), error => error.code === 'not_found' && error.status === 404);
  await assert.rejects(f.connector.update(credential, { channel: 'C1', ts: TS2, text: '' }), /invalid_message/);
  for (const call of [
    () => f.connector.reaction(credential, { channel: 'C1', ts: TS1, name: 'eyes', on: true }),
    () => f.connector.markRead(credential, { channel: 'C1', ts: TS1 }),
    () => f.connector.search(credential, { query: 'hello' }),
  ]) await assert.rejects(call(), error => error.code === 'missing_scopes' && error.status === 403);
  assert.ok(!f.calls.some(c => ['reactions.add', 'conversations.mark', 'search.messages'].includes(c.method)), 'no Slack call is made for an ungranted capability');
});

test('with the optional scopes granted, reactions tolerate already_reacted and search/mark work', async t => {
  const f = fixture(t, { scopes: [...requestedScopes, 'reactions:write', 'reactions:read', 'search:read', 'channels:write', 'groups:write', 'im:write', 'mpim:write'] });
  const { credential, capabilities } = await f.connect();
  assert.equal(capabilities.reactions, true);
  assert.deepEqual(await f.connector.reaction(credential, { channel: 'C1', ts: TS1, name: 'eyes', on: true }), { ok: true });
  assert.deepEqual(await f.connector.reaction(credential, { channel: 'C1', ts: TS1, name: 'tada', on: false }), { ok: true });
  await assert.rejects(f.connector.reaction(credential, { channel: 'C1', ts: TS1, name: 'Bad Name', on: true }), /invalid_request/);
  assert.deepEqual(await f.connector.markRead(credential, { channel: 'C1', ts: TS1 }), { ok: true });
  const found = await f.connector.search(credential, { query: 'hello' });
  assert.deepEqual(found.messages.map(m => [m.id, m.channelId]), [[TS1, 'C1']]);
});

test('Events API chat events reach only the authorized grant, in order, with bounded replay and gap detection', async t => {
  const f = fixture(t);
  const a = await f.connect();
  assert.deepEqual(f.connector.stream(a.credential, 0), { events: [], seq: 0, gap: false });
  assert.deepEqual(f.event(slackMessage(TS1, { channel: 'C1' })), { ok: true });
  f.event({ type: 'reaction_added', user: 'U2', reaction: 'eyes', item: { type: 'message', channel: 'C1', ts: TS1 } });
  f.event(slackMessage(TS3, { channel: 'C1', thread_ts: TS1 }), { authorizations: [{ user_id: 'U9', team_id: 'T1', is_bot: false }] }); // another user's grant
  f.event(slackMessage(TS2, { channel: 'C1' }), { authorizations: [{ user_id: 'B1', team_id: 'T1', is_bot: true }] }); // bot authorization only
  f.event({ type: 'user_typing', channel: 'C1', user: 'U2' });
  const first = f.connector.stream(a.credential, 0);
  assert.deepEqual(first.events.map(e => e.type), ['message.created', 'reaction.added']);
  assert.equal(first.gap, false);
  const next = f.connector.stream(a.credential, first.seq);
  assert.deepEqual(next.events, []);
  assert.equal(next.seq, first.seq);
  // A duplicate delivery of the same event_id is stored once.
  f.event(slackMessage(TS1, { channel: 'C1' }), {}, 'dup');
  f.event(slackMessage(TS1, { channel: 'C1' }), {}, 'dup');
  assert.equal(f.connector.stream(a.credential, first.seq).events.length, 1);
  // Retention: after the window the rows are gone and a stale cursor reports a gap.
  const seq = f.connector.stream(a.credential, 0).seq;
  f.advance(301_000);
  f.event(slackMessage(TS2, { channel: 'C1' }));
  const late = f.connector.stream(a.credential, 1);
  assert.equal(late.gap, true);
  assert.equal(late.events.length, 1);
  assert.ok(late.seq > seq);
});

test('a malformed event is acknowledged and dropped; the next good one still streams', async t => {
  const f = fixture(t);
  const a = await f.connect();
  assert.deepEqual(f.event({ type: 'message', channel: 'C1', user: 'U1', ts: 1789171841.148649, text: 'ts as a number' }), { ok: true }, 'acknowledged so Slack does not retry');
  assert.deepEqual(f.event({ type: 'message', subtype: 'message_changed', channel: 'C1', message: { ts: 'not-a-ts', text: 'edited' } }), { ok: true }, 'a payload the normalizer rejects is dropped, not retried');
  assert.deepEqual(f.event({ type: 'message', channel: 'C1', user: 'U1', ts: TS1, text: 'fine', blocks: [{ type: 'unknown_block_kind', weird: true }], extra_field_from_the_future: 1 }), { ok: true });
  const stream = f.connector.stream(a.credential, 0);
  assert.deepEqual(stream.events.map(e => [e.type, e.message?.provenance.degraded]), [['message.created', true]], 'unknown blocks degrade the message; unknown fields are ignored');
  assert.equal(f.connector.driftCount, 1);
});

test('sends are idempotent per client id; an unknown outcome is reconciled on retry, never posted twice', async t => {
  let mode = 'ok';
  const posted = [];
  const f = fixture(t, { fetcher: async (method, params) => {
    if (method === 'chat.postMessage') {
      if (mode === 'timeout') { const error = new Error('timed out'); error.name = 'TimeoutError'; throw error; }
      if (mode === 'down') return new Response('bad gateway', { status: 502 });
      posted.push(params);
      return { ok: true, channel: params.channel, ts: `1700000000.00000${posted.length}`, message: { user: 'U1', type: 'message', text: params.text, ts: `1700000000.00000${posted.length}`, bot_id: 'B9' } };
    }
    if (method === 'conversations.history' && mode === 'found') return { ok: true, messages: [{ type: 'message', user: 'U1', ts: '1800000000.000009', text: 'hello *there*' }], has_more: false };
    return null;
  } });
  const { credential } = await f.connect();
  const first = await f.connector.send(credential, { channel: 'C1', text: 'hello **there**', client_msg_id: 'client-msg-0001' });
  const again = await f.connector.send(credential, { channel: 'C1', text: 'hello **there**', client_msg_id: 'client-msg-0001' });
  assert.equal(again.ts, first.ts);
  assert.equal(posted.length, 1, 'a repeated send with the same id posts once');
  assert.equal(posted[0].text, 'hello *there*', 'markdown goes out as mrkdwn');
  // Unknown outcome: Slack never answered. The client gets 504 and keeps its id.
  mode = 'timeout';
  await assert.rejects(f.connector.send(credential, { channel: 'C1', text: 'hello **there**', client_msg_id: 'client-msg-0002' }), error => error.code === 'send_unknown' && error.status === 504);
  // The retry reconciles first: Slack already has the message, so it is returned, not re-posted.
  mode = 'found';
  const reconciled = await f.connector.send(credential, { channel: 'C1', text: 'hello **there**', client_msg_id: 'client-msg-0002' });
  assert.equal(reconciled.ts, '1800000000.000009');
  assert.equal(reconciled.reconciled, true);
  assert.equal(reconciled.message.body, 'hello **there**');
  assert.equal(posted.length, 1, 'nothing was posted again');
  assert.equal(f.calls.filter(c => c.method === 'conversations.history').length, 1, 'one reconciliation read');
  // A retry whose reconciliation finds nothing posts once.
  mode = 'down';
  await assert.rejects(f.connector.send(credential, { channel: 'C1', text: 'new text', client_msg_id: 'client-msg-0003' }), /send_unknown/);
  mode = 'ok';
  const third = await f.connector.send(credential, { channel: 'C1', text: 'new text', client_msg_id: 'client-msg-0003' });
  assert.equal(third.reconciled, undefined);
  assert.equal(posted.length, 2);
  // A definite Slack refusal is not remembered: the next attempt may post.
  await assert.rejects(f.connector.send(credential, { channel: 'C1', text: 'x', client_msg_id: 'bad id!' }), /invalid_message/);
  // The memory expires.
  f.advance(601_000);
  const later = await f.connector.send(credential, { channel: 'C1', text: 'hello **there**', client_msg_id: 'client-msg-0001' });
  assert.notEqual(later.ts, first.ts);
});

test('HTTP: baseline routes are credential-bound, JSON-only, and carry Retry-After on 429', async t => {
  const f = fixture(t);
  const server = createConnectorServer(f.connector);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const { credential } = await f.connect();
  const auth = { authorization: `Bearer ${credential}`, origin: 'https://flow.test' };
  const conversations = await (await fetch(`${base}/v1/conversations`, { headers: auth })).json();
  assert.equal(conversations.conversations.length, 3);
  const history = await fetch(`${base}/v1/history?channel=C1&limit=15`, { headers: auth });
  assert.equal(history.status, 200);
  assert.equal((await history.json()).messages.length, 3);
  assert.equal((await fetch(`${base}/v1/history?channel=C1`)).status, 401);
  const edited = await fetch(`${base}/v1/messages`, { method: 'PATCH', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ channel: 'C1', ts: TS2, text: 'edit' }) });
  assert.equal(edited.status, 200);
  const reaction = await fetch(`${base}/v1/reactions`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ channel: 'C1', ts: TS1, name: 'eyes', on: true }) });
  assert.equal(reaction.status, 403);
  assert.deepEqual(await reaction.json(), { error: 'missing_scopes' });
  f.state.rateLimitNext = 1;
  const limited = await fetch(`${base}/v1/history?channel=C1`, { headers: auth });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '60');
  const preflight = await fetch(`${base}/v1/messages`, { method: 'OPTIONS', headers: { origin: 'https://flow.test' } });
  assert.match(preflight.headers.get('access-control-allow-methods'), /PATCH/);
});
