// Public-API baseline routes (#545): read, mutations, capability gating,
// shared rate budgets, and Events API routing per grant. The fake Slack keeps
// live-shaped replies (see decision_log 2026-09-11: trust live over docs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHmac } from 'node:crypto';
import { Store } from '../src/store.js';
import { Connector, hash, opaque } from '../src/connector.js';
import { requestedScopes, requestedEvents, grantedCapabilities } from '../src/manifest.js';
import { botMember, channelTopic, messageMarkdown, normalizeMessage, normalizeEvent, isDegraded, emojiFromName, expandBodyEmoji, tsToIso } from '../src/normalize.js';
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
    const params = Object.fromEntries(new URLSearchParams(request.body instanceof URLSearchParams || typeof request.body === 'string' ? request.body : ''));
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
  const connector = new Connector({ store, clientId: '123.456', clientSecret: 'client-secret', publicOrigin: 'https://connector.test', clientOrigins: ['https://flow.test', ...(options.clientOrigins ?? [])], signingSecret: 'signing-secret', fetcher, now: () => now });
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
  // Layout blocks and attachments render; interactive parts are what Flow leaves out.
  assert.equal(isDegraded({ blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'x' } }] }), false);
  assert.equal(isDegraded({ attachments: [{ fallback: 'x' }] }), false);
  assert.equal(isDegraded({ blocks: [{ type: 'actions', elements: [{ type: 'button' }] }] }), true);
  assert.equal(isDegraded({ blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'x' }, accessory: { type: 'button' } }] }), true);
  assert.equal(isDegraded({ attachments: [{ fallback: 'x', actions: [{ type: 'button' }] }] }), true);
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
  assert.deepEqual(requestedEvents.sort(), ['app_uninstalled', 'message.channels', 'message.groups', 'message.im', 'message.mpim', 'tokens_revoked', 'user_change']);
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

test('HTTP: a native client signs in without an Origin header and returns to its own URL scheme', async t => {
  const f = fixture(t, { clientOrigins: ['flow://slack'] });
  const server = createConnectorServer(f.connector);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const json = { 'content-type': 'application/json' };
  const post = (path, body, headers = {}) => fetch(`${base}${path}`, { method: 'POST', headers: { ...json, ...headers }, body: JSON.stringify(body) });
  const verifier = opaque();
  // No Origin header, native client origin: allowed. Same body from a browser
  // origin, or a native origin nobody configured: refused.
  const started = await post('/v1/oauth/start', { challenge: hash(verifier), clientOrigin: 'flow://slack' });
  assert.equal(started.status, 200);
  const { authorizationUrl, operationId } = await started.json();
  assert.equal((await post('/v1/oauth/start', { challenge: hash(verifier), clientOrigin: 'flow://slack' }, { origin: 'https://evil.test' })).status, 403);
  assert.equal((await post('/v1/oauth/start', { challenge: hash(verifier), clientOrigin: 'flow://other' })).status, 403);
  // Polling before consent says pending, and the verifier is what binds it.
  assert.deepEqual(await (await post('/v1/oauth/poll', { verifier, operationId, clientOrigin: 'flow://slack' })).json(), { status: 'pending' });
  assert.equal((await post('/v1/oauth/poll', { verifier: opaque(), operationId, clientOrigin: 'flow://slack' })).status, 400);
  // Slack's redirect lands on the connector, which bounces to flow://slack with
  // only the operation id: no handoff or credential in the URL.
  const state = new URL(authorizationUrl).searchParams.get('state');
  const callback = await fetch(`${base}/oauth/callback?state=${state}&code=T1`, { redirect: 'manual' });
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get('location'), `flow://slack/connected?operationId=${encodeURIComponent(operationId)}`);
  const done = await (await post('/v1/oauth/poll', { verifier, operationId, clientOrigin: 'flow://slack' })).json();
  assert.equal(done.status, 'connected');
  assert.equal(done.identity.teamId, 'T1');
  assert.match(done.credential, /^[A-Za-z0-9_-]+$/);
  // The credential then works on the read routes with no Origin at all.
  const me = await fetch(`${base}/v1/workspace`, { headers: { authorization: `Bearer ${done.credential}` } });
  assert.equal(me.status, 200);
});

test('file previews: images get hasThumb only with files:read; bytes come through the connector with the user token', async t => {
  const image = { id: 'F0IMAGE1', name: 'image.png', mimetype: 'image/png', size: 183000, original_w: 800, original_h: 600, url_private: 'https://files.slack.com/files-pri/T1-F0IMAGE1/image.png', thumb_720: 'https://files.slack.com/files-tmb/T1-F0IMAGE1-x/image_720.png' };
  assert.equal(normalizeMessage(slackMessage(TS1, { files: [image] }), { teamId: 'T1', channelId: 'C1' }).files[0].hasThumb, false);
  assert.equal(normalizeMessage(slackMessage(TS1, { files: [image] }), { teamId: 'T1', channelId: 'C1', readFiles: true }).files[0].hasThumb, true);
  assert.equal(normalizeMessage(slackMessage(TS1, { files: [{ ...image, id: 'F0TEXT01', mimetype: 'text/plain' }] }), { teamId: 'T1', channelId: 'C1', readFiles: true }).files[0].hasThumb, false);

  const seen = [];
  const f = fixture(t, { scopes: [...requestedScopes], fetcher: async (method, params, request) => {
    if (method === 'conversations.history') return { ok: true, messages: [slackMessage(TS1, { files: [image] })], has_more: false };
    if (method === 'files.info') return params.file === 'F0EVIL01' ? { ok: true, file: { ...image, id: 'F0EVIL01', url_private: 'https://evil.test/x.png' } } : { ok: false, error: 'file_not_found' };
    if (method === 'image_720.png' || method === 'image.png') { seen.push({ method, authorization: request.headers.authorization }); return new Response(Buffer.from('PNGDATA'), { headers: { 'content-type': 'image/png', 'content-length': '7' } }); }
    if (method === 'sign-in.png') return new Response('<html>', { headers: { 'content-type': 'text/html' } });
  } });
  const server = createConnectorServer(f.connector);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const { credential } = await f.connect();
  const auth = { authorization: `Bearer ${credential}`, origin: 'https://flow.test' };
  const history = await (await fetch(`${base}/v1/history?channel=C1`, { headers: auth })).json();
  assert.equal(history.messages[0].files[0].hasThumb, true);
  assert.deepEqual(await (await fetch(`${base}/v1/files/F0IMAGE1/thumb/url`, { headers: auth })).json(), { url: null, expiresInSeconds: 0 });
  const thumb = await fetch(`${base}/v1/files/F0IMAGE1/thumb`, { headers: auth });
  assert.equal(thumb.status, 200);
  assert.equal(thumb.headers.get('content-type'), 'image/png');
  assert.equal(Buffer.from(await thumb.arrayBuffer()).toString(), 'PNGDATA');
  assert.equal((await fetch(`${base}/v1/files/F0IMAGE1`, { headers: auth })).status, 200);
  assert.deepEqual(seen, [{ method: 'image_720.png', authorization: 'Bearer secret-T1' }, { method: 'image.png', authorization: 'Bearer secret-T1' }]);
  assert.equal(f.calls.filter(c => c.method === 'files.info').length, 0, 'a file seen in history needs no files.info');
  // Never fetches a non-Slack host; unknown files 404; no credential 401.
  assert.equal((await fetch(`${base}/v1/files/F0EVIL01`, { headers: auth })).status, 404);
  assert.equal((await fetch(`${base}/v1/files/F0MISSNG`, { headers: auth })).status, 404);
  assert.equal((await fetch(`${base}/v1/files/F0IMAGE1/thumb`)).status, 401);
  // A token Slack will not honor comes back as its sign-in page: refused, not served.
  const [grantId] = JSON.parse([...f.connector.fileRefs.keys()][0]);
  f.connector.rememberFiles(grantId, [{ files: [{ ...image, id: 'F0HTML01', url_private: 'https://files.slack.com/x/sign-in.png' }] }]);
  assert.equal((await fetch(`${base}/v1/files/F0HTML01`, { headers: auth })).status, 403);

  const noScope = fixture(t, { scopes: requestedScopes.filter(s => s !== 'files:read') });
  const { credential: other } = await noScope.connect();
  await assert.rejects(noScope.connector.file(other, { id: 'F0IMAGE1', variant: 'thumb' }), /missing_scopes/);
});

test('custom emoji: Flow-shaped list with aliases resolved; images fetched without the user token', async t => {
  const seen = [];
  const f = fixture(t, { scopes: [...requestedScopes], fetcher: async (method, params, request) => {
    if (method === 'emoji.list') return { ok: true, emoji: { merged: 'https://emoji.slack-edge.com/T1/merged/abc.png', shipit: 'alias:merged', thumbsup_all: 'alias:+1', evil: 'https://evil.test/e.png' } };
    if (method === 'abc.png') { seen.push(request.headers.authorization ?? null); return new Response(Buffer.from('GIF'), { headers: { 'content-type': 'image/png' } }); }
  } });
  const server = createConnectorServer(f.connector);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const { credential } = await f.connect();
  const auth = { authorization: `Bearer ${credential}`, origin: 'https://flow.test' };
  const list = await (await fetch(`${base}/v1/workspaces/T1/emoji`, { headers: auth })).json();
  assert.deepEqual(list.emoji.map(e => [e.emoji, e.fileId]), [[':merged:', 'emoji:merged'], [':shipit:', 'emoji:shipit']]);
  assert.equal((await fetch(`${base}/v1/workspaces/T2/emoji`, { headers: auth })).status, 404);
  const img = await fetch(`${base}/v1/files/emoji:shipit`, { headers: auth });
  assert.equal(img.status, 200);
  assert.deepEqual(seen, [null]);
  assert.equal((await fetch(`${base}/v1/files/emoji:evil`, { headers: auth })).status, 404);
  assert.equal(f.calls.filter(c => c.method === 'emoji.list').length, 1, 'emoji.list is cached');
});

test('message text emoji shortcodes become unicode; custom names and code stay as text', () => {
  assert.equal(expandBodyEmoji('Happy birthday :tada::balloon: :thankyou:'), 'Happy birthday 🎉🎈 :thankyou:');
  assert.equal(expandBodyEmoji('hi :wave::skin-tone-3:'), 'hi 👋🏼');
  // Every standard Slack name, not only the shared picker table.
  assert.equal(expandBodyEmoji(':two_hearts::sparkles::heart_hands: :partyparrot:'), '💕✨🫶 :partyparrot:');
  assert.equal(emojiFromName('heart_hands'), '🫶');
  assert.equal(emojiFromName('thumbsup::skin-tone-4'), '👍🏽');
  assert.equal(emojiFromName('partyparrot'), ':partyparrot:');
  assert.equal(expandBodyEmoji(':thankyou::skin-tone-2:'), ':thankyou:');
  assert.equal(expandBodyEmoji('run `:tada:` at 10:30:45'), 'run `:tada:` at 10:30:45');
  const m = normalizeMessage({ ts: '1789171841.148649', user: 'U1', text: 'Happy birthday <@U08JDGF1EAY> :partying_face:' }, { teamId: 'T1', channelId: 'C1' });
  assert.equal(m.body, 'Happy birthday <@U08JDGF1EAY> 🥳');
});

test('status: user_change streams member.updated to every grant on the team; PATCH /v1/me sets the Slack status', async t => {
  const sets = [];
  const f = fixture(t, { scopes: [...requestedScopes], fetcher: async (method, params) => {
    if (method === 'users.profile.set') { sets.push(JSON.parse(params.profile)); return { ok: true, profile: { real_name: 'Alice A', display_name: 'alice', email: 'a@example.test', status_emoji: JSON.parse(params.profile).status_emoji, status_text: JSON.parse(params.profile).status_text } }; }
  } });
  const { credential } = await f.connect();
  // Slack names someone else in `authorizations`; a profile change still reaches this grant.
  f.event({ type: 'user_change', user: { id: 'U2', name: 'bob', profile: { real_name: 'Bob', status_emoji: ':face_with_thermometer:', status_text: 'Out sick' } } }, { authorizations: [{ user_id: 'U9', team_id: 'T1', is_bot: false }] });
  const stream = f.connector.stream(credential, 0);
  assert.equal(stream.events.length, 1);
  assert.equal(stream.events[0].type, 'member.updated');
  assert.equal(stream.events[0].member.userId, 'U2');
  assert.equal(stream.events[0].member.statusEmoji, '🤒');
  assert.equal(stream.events[0].member.statusText, 'Out sick');
  assert.equal('deleted' in stream.events[0].member, false);

  const server = createConnectorServer(f.connector);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const patch = body => fetch(`${base}/v1/me`, { method: 'PATCH', headers: { authorization: `Bearer ${credential}`, origin: 'https://flow.test', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const set = await patch({ statusEmoji: '🗓', statusText: 'In a meeting', statusSuppressAlerts: true });
  assert.equal(set.status, 200);
  const user = await set.json();
  assert.equal(user.id, 'U1');
  assert.equal(user.statusEmoji, '🗓️');
  assert.equal(user.statusText, 'In a meeting');
  assert.equal((await patch({ statusEmoji: '', statusText: '' })).status, 200);
  assert.deepEqual(sets, [{ status_text: 'In a meeting', status_emoji: ':spiral_calendar_pad:', status_expiration: 0 }, { status_text: '', status_emoji: '', status_expiration: 0 }]);
  assert.deepEqual(await (await patch({ statusEmoji: '🦩🦩', statusText: 'x' })).json(), { error: 'unsupported_emoji' });

  const noScope = fixture(t, { scopes: requestedScopes.filter(s => s !== 'users.profile:write') });
  const { credential: other } = await noScope.connect();
  await assert.rejects(noScope.connector.setStatus(other, { statusEmoji: '🤒', statusText: 'Out sick' }), /missing_scopes/);
});

test('team icon: workspace avatarUrl points at the connector, which serves the team.info icon without a token', async t => {
  const seen = [];
  const f = fixture(t, { scopes: [...requestedScopes], fetcher: async (method, params, request) => {
    if (method === 'team.info') return { ok: true, team: { id: 'T1', icon: { image_132: 'https://avatars.slack-edge.com/2025/icon_132.png', image_default: false } } };
    if (method === 'icon_132.png') { seen.push(request.headers.authorization ?? null); return new Response(Buffer.from('PNG'), { headers: { 'content-type': 'image/png' } }); }
  } });
  const server = createConnectorServer(f.connector);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const { credential } = await f.connect();
  const auth = { authorization: `Bearer ${credential}`, origin: 'https://flow.test' };
  const workspace = await (await fetch(`${base}/v1/workspace`, { headers: auth })).json();
  assert.equal(workspace.avatarUrl, '/v1/files/team-icon:T1');
  const icon = await fetch(`${base}${workspace.avatarUrl}`, { headers: auth });
  assert.equal(icon.status, 200);
  assert.deepEqual(seen, [null]);
  assert.equal((await fetch(`${base}/v1/files/team-icon:T2`, { headers: auth })).status, 404);
  assert.equal(f.calls.filter(c => c.method === 'team.info').length, 1, 'team.info is cached');

  const bare = fixture(t, { scopes: requestedScopes.filter(s => s !== 'team:read') });
  const { credential: other } = await bare.connect();
  assert.equal((await bare.connector.workspace(other)).avatarUrl, null);
});

test('uploads: bytes go to Slack upload URL, send completes them as one message with the text, retries never re-complete', async t => {
  const uploaded = [];
  let shared = true;
  const f = fixture(t, { scopes: [...requestedScopes], fetcher: async (method, params, request) => {
    if (method === 'files.getUploadURLExternal') return { ok: true, file_id: 'F0UPLOAD1', upload_url: 'https://files.slack.com/upload/v1/abc123' };
    if (method === 'abc123') { uploaded.push({ bytes: Buffer.from(request.body).toString(), authorization: request.headers.authorization ?? null }); return new Response('OK - 5'); }
    if (method === 'files.completeUploadExternal') return { ok: true, files: [{ id: 'F0UPLOAD1', title: 'notes.txt' }] };
    if (method === 'files.info') return { ok: true, file: { id: params.file, name: 'notes.txt', mimetype: 'text/plain', size: 5, shares: shared ? { public: { C1: [{ ts: '1789180000.000100', channel_name: 'testing' }] } } : {} } };
  } });
  f.connector.sleep = async () => {};
  const server = createConnectorServer(f.connector);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const { credential } = await f.connect();
  const auth = { authorization: `Bearer ${credential}`, origin: 'https://flow.test' };

  const up = await fetch(`${base}/v1/files?channel=C1&name=notes.txt`, { method: 'POST', headers: { ...auth, 'content-type': 'text/plain' }, body: 'hello' });
  assert.equal(up.status, 200);
  const file = await up.json();
  assert.deepEqual([file.id, file.name, file.mimeType, file.sizeBytes], ['F0UPLOAD1', 'notes.txt', 'text/plain', 5]);
  assert.deepEqual(uploaded, [{ bytes: 'hello', authorization: null }], 'the upload URL is pre-authorized; the token is not sent');
  assert.equal(f.calls.find(c => c.method === 'files.getUploadURLExternal').params.length, '5');

  const send = body => fetch(`${base}/v1/messages`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  // A file for another channel is refused.
  assert.equal((await send({ channel: 'C2', text: '', file_ids: ['F0UPLOAD1'], client_msg_id: 'cm-other-1' })).status, 400);
  shared = false;
  const pending = await send({ channel: 'C1', text: 'see *notes*', file_ids: ['F0UPLOAD1'], client_msg_id: 'cm-files-1' });
  assert.equal(pending.status, 504);
  const complete = f.calls.filter(c => c.method === 'files.completeUploadExternal');
  assert.equal(complete.length, 1);
  assert.deepEqual(JSON.parse(complete[0].params.files), [{ id: 'F0UPLOAD1', title: 'notes.txt' }]);
  assert.equal(complete[0].params.initial_comment, 'see *notes*');
  shared = true;
  const done = await send({ channel: 'C1', text: 'see *notes*', file_ids: ['F0UPLOAD1'], client_msg_id: 'cm-files-1' });
  assert.equal(done.status, 200);
  const result = await done.json();
  assert.equal(result.ts, '1789180000.000100');
  assert.equal(result.message.body, 'see **notes**');
  assert.equal(result.message.files[0].id, 'F0UPLOAD1');
  assert.equal(f.calls.filter(c => c.method === 'files.completeUploadExternal').length, 1, 'the retry only looked again');

  const noScope = fixture(t, { scopes: requestedScopes.filter(s => s !== 'files:write') });
  const { credential: other } = await noScope.connect();
  await assert.rejects(noScope.connector.upload(other, { channel: 'C1', name: 'a.txt', type: 'text/plain', bytes: Buffer.from('x') }), /missing_scopes/);
});

test('activity: conversations carry lastActivityAt from checks, history loads and live messages; the check yields to readers', async t => {
  const f = fixture(t);
  const { credential } = await f.connect();
  const first = await f.connector.conversations(credential);
  assert.deepEqual(first.map(c => [c.id, c.lastActivityAt]), [['C1', null], ['D1', null], ['G1', null]]);

  // Channels are checked before group DMs, and group DMs before DMs.
  assert.equal((await f.connector.activityTick()).channelId, 'C1');
  assert.equal(f.calls.filter(c => c.method === 'conversations.history').at(-1).params.limit, '1');
  assert.equal((await f.connector.activityTick()).channelId, 'G1');
  const events = f.connector.stream(credential, 0).events.filter(e => e.type === 'channel.activity');
  assert.deepEqual(events.map(e => [e.channelId, e.lastActivityAt]), [['C1', tsToIso(TS3)], ['G1', tsToIso(TS3)]]);

  // Someone reading history pauses the check for two minutes.
  await f.connector.history(credential, { channel: 'D1', limit: 15 });
  assert.equal(await f.connector.activityTick(), null);
  f.advance(121_000);
  assert.equal(await f.connector.activityTick(), null, 'D1 was learned from the history load, so nothing is left');

  // A live message moves a channel forward; an older ts never moves it back.
  const later = '1789190000.000001';
  f.event({ type: 'message', channel: 'C1', user: 'U2', ts: later, text: 'new' });
  f.connector.recordActivity(JSON.parse(JSON.stringify([...f.connector.activityTargets.keys()][0])), 'C1', TS1);
  const again = await f.connector.conversations(credential);
  assert.equal(again.find(c => c.id === 'C1').lastActivityAt, tsToIso(later));
  assert.equal(again.find(c => c.id === 'D1').lastActivityAt, tsToIso(TS3));
});

test('bot senders: an app message names its bot in members and on the stream, not Unknown', async t => {
  const sentinel = { type: 'message', subtype: 'bot_message', bot_id: 'B0SENTINEL', ts: TS1, text: '[FIRING] KubeCPUOvercommit', bot_profile: { id: 'B0SENTINEL', name: 'Sentinel', app_id: 'A0S', icons: { image_72: 'https://avatars.slack-edge.com/sentinel_72.png' } } };
  assert.deepEqual([botMember(sentinel).userId, botMember(sentinel).displayName, botMember(sentinel).avatarUrl, botMember(sentinel).isBot], ['B0SENTINEL', 'Sentinel', 'https://avatars.slack-edge.com/sentinel_72.png', true]);
  assert.equal(botMember({ ...sentinel, bot_profile: undefined, username: 'deploy-hook', icons: { image_48: 'https://x.test/h.png' } }).displayName, 'deploy-hook');
  assert.equal(botMember(slackMessage(TS1)), null, 'a person is not a bot row');

  const f = fixture(t, { fetcher: async method => { if (method === 'conversations.history') return { ok: true, messages: [sentinel, slackMessage(TS2)], has_more: false }; } });
  const { credential } = await f.connect();
  const page = await f.connector.history(credential, { channel: 'C1', limit: 15 });
  assert.equal(page.messages.find(m => m.id === TS1).userId, 'B0SENTINEL');
  const members = await f.connector.members(credential);
  assert.equal(members.find(m => m.userId === 'B0SENTINEL').displayName, 'Sentinel');
  const updates = f.connector.stream(credential, 0).events.filter(e => e.type === 'member.updated');
  assert.deepEqual(updates.map(e => e.member.displayName), ['Sentinel']);
  await f.connector.history(credential, { channel: 'C1', limit: 15 });
  assert.equal(f.connector.stream(credential, 0).events.filter(e => e.type === 'member.updated').length, 1, 'seen again: no new event');
});

test('Block Kit layout and legacy attachments render as markdown instead of the fallback text', () => {
  // Alertmanager-style legacy attachment: color bar card with a linked title.
  const firing = { type: 'message', subtype: 'bot_message', bot_id: 'B0SENTINEL', ts: TS1, text: '',
    attachments: [{ color: '#a30200', fallback: '[FIRING] KubeCPUOvercommit', title: '[FIRING] KubeCPUOvercommit', title_link: 'https://alerts.example.test/1', text: '*KubeCPUOvercommit* — warning Cluster has overcommitted CPU', fields: [{ title: 'Severity', value: 'warning', short: true }], footer: 'Sentinel' }] };
  assert.equal(messageMarkdown(firing), '> **[FIRING] KubeCPUOvercommit [↗](https://alerts.example.test/1)**\n> **KubeCPUOvercommit** — warning Cluster has overcommitted CPU\n> **Severity:** warning\n> Sentinel');
  assert.equal(normalizeMessage(firing, { teamId: 'T1', channelId: 'C1' }).provenance.degraded, false);

  // Blocks replace the fallback text: header, fields, divider, context.
  const scan = { type: 'message', bot_id: 'B0ECR', ts: TS2, text: 'ECR Security Scan Alert fallback',
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: ':rotating_light: ECR Security Scan Alert' } },
      { type: 'section', fields: [{ type: 'mrkdwn', text: '*Repository:*\n`btdash-frontend:prod`' }, { type: 'mrkdwn', text: '*Critical:* 0 | *High:* 1' }] },
      { type: 'divider' },
      { type: 'context', elements: [{ type: 'mrkdwn', text: 'Scanned by <https://aws.example.test|Inspector>' }, { type: 'image', image_url: 'https://x.test/i.png', alt_text: 'aws' }] },
    ] };
  const body = normalizeMessage(scan, { teamId: 'T1', channelId: 'C1' }).body;
  assert.equal(body, '**🚨 ECR Security Scan Alert**\n\n**Repository:**\n`btdash-frontend:prod`\n**Critical:** 0 | **High:** 1\n\n---\n\nScanned by [Inspector](https://aws.example.test)');
  assert.ok(!body.includes('fallback'));

  // Attachment built from blocks, text kept above it; a plain rich_text message still uses text.
  const mixed = { type: 'message', user: 'U1', ts: TS3, text: 'deploy done', attachments: [{ color: 'good', pretext: 'Details', blocks: [{ type: 'section', text: { type: 'mrkdwn', text: '*prod* ok' } }, { type: 'divider' }] }] };
  assert.equal(messageMarkdown(mixed), 'deploy done\n\nDetails\n> **prod** ok');
  assert.equal(messageMarkdown(slackMessage(TS1)), 'hello **world** & <@U2>');
});

test('profile card: /v1/users/:id answers a person from users.info and an app from the remembered bot', async t => {
  const f = fixture(t, { fetcher: async (method, params) => {
    if (method === 'users.info') return params.user === 'U2' ? { ok: true, user: { id: 'U2', name: 'bob', tz: 'America/Chicago', profile: { real_name: 'Bob B', title: 'Engineer', status_text: 'Out sick', status_emoji: ':face_with_thermometer:', image_72: 'https://avatars.slack-edge.com/bob_72.png' } } } : { ok: false, error: 'user_not_found' };
    if (method === 'conversations.history') return { ok: true, messages: [{ type: 'message', bot_id: 'B0SENTINEL', ts: TS1, text: 'x', bot_profile: { name: 'Sentinel', icons: { image_72: 'https://avatars.slack-edge.com/s.png' } } }], has_more: false };
  } });
  const server = createConnectorServer(f.connector);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const { credential } = await f.connect();
  const get = path => fetch(`${base}${path}`, { headers: { authorization: `Bearer ${credential}`, origin: 'https://flow.test' } });
  const bob = await (await get('/v1/users/U2')).json();
  assert.deepEqual([bob.id, bob.displayName, bob.timezone, bob.title, bob.statusText, bob.statusEmoji, bob.website, bob.isAgent], ['U2', 'Bob B', 'America/Chicago', 'Engineer', 'Out sick', '🤒', '', false]);
  assert.equal((await get('/v1/users/U9')).status, 404);
  assert.equal((await get('/v1/users/B0SENTINEL')).status, 404, 'an app not seen yet');
  await f.connector.history(credential, { channel: 'C1', limit: 15 });
  assert.equal((await (await get('/v1/users/B0SENTINEL')).json()).displayName, 'Sentinel');
});

test('channel topics are mrkdwn: links, mentions and emoji render like a message', () => {
  assert.equal(channelTopic('Support emails sent to <mailto:support@biztrip.ai|support@biztrip.ai>'), 'Support emails sent to [support@biztrip.ai](mailto:support@biztrip.ai)');
  assert.equal(channelTopic('Ship it :rocket: with <@U2>'), 'Ship it 🚀 with <@U2>');
  assert.equal(channelTopic('  '), null);
  assert.equal(channelTopic(undefined), null);
});

test('agent app replies: markdown blocks render, and unknown or empty blocks fall back to the text', () => {
  const cosmo = { type: 'message', user: 'U0C28SL44AZ', bot_id: 'B0COSMO', ts: TS1, thread_ts: TS1,
    text: 'Your 4 most recent conversations:\n\n1. *Mala* — "will do tonight."',
    blocks: [{ type: 'markdown', text: 'Your 4 most recent conversations:\n\n1. **Mala** — "will do tonight."' }] };
  assert.equal(messageMarkdown(cosmo), 'Your 4 most recent conversations:\n\n1. **Mala** — "will do tonight."');
  assert.equal(normalizeMessage(cosmo, { teamId: 'T1', channelId: 'C1' }).provenance.degraded, false);

  // A block type Flow does not know: Slack's text stands in, and the message is marked partial.
  const future = { ...cosmo, blocks: [{ type: 'plan', title: 'Steps', tasks: [] }] };
  assert.equal(messageMarkdown(future), 'Your 4 most recent conversations:\n\n1. **Mala** — "will do tonight."');
  assert.equal(normalizeMessage(future, { teamId: 'T1', channelId: 'C1' }).provenance.degraded, true);

  // Blocks that draw to nothing never blank a message that has text.
  assert.equal(messageMarkdown({ ...cosmo, blocks: [{ type: 'section', fields: [] }] }), 'Your 4 most recent conversations:\n\n1. **Mala** — "will do tonight."');
  // Buttons are left out without hiding the layout around them.
  assert.equal(messageMarkdown({ ...cosmo, blocks: [{ type: 'header', text: { type: 'plain_text', text: 'Deploy' } }, { type: 'actions', elements: [{ type: 'button' }] }] }), '**Deploy**');
});
