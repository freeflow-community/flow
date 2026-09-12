// The REAL Slack connector (packages/slack-connector) on loopback with a fake
// Slack behind it (#546 acceptance; #545's harness plus the failure knobs). Every route, the normalizer, the rate
// budget and the event stream are the shipped code; only slack.com is
// substituted, with the live-shaped replies the connector tests use.
//
//   node docs/qa/issue-546/fake-slack-connector.mjs [--port 8792] [--client http://127.0.0.1:5180]
//
// Prints one JSON line with the seeded session credential for the browser
// test. Behaviour knobs (all deterministic):
//   - conversations: #testing (C1), a DM (D1), a group DM (G1)
//   - history in C1: 17 messages, 15 per page, then a 429 with Retry-After: 5
//     on the second page for 5 s (the measured non-Marketplace limit, shortened)
//   - reactions/search/mark: missing_scope (the test app's real grant)
//   - the FIRST chat.postMessage is accepted by Slack but answered with a 503:
//     an unknown outcome. The connector must reconcile on retry, never post twice
//   - 8 s after start, three Events API deliveries for C1: two messages out of
//     order (the later ts first) and one malformed payload between them
import { createHmac, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { Store } = await import(require.resolve('../../../packages/slack-connector/src/store.js'));
const { Connector, hash, opaque } = await import(require.resolve('../../../packages/slack-connector/src/connector.js'));
const { createConnectorServer } = await import(require.resolve('../../../packages/slack-connector/src/http.js'));
const { requestedScopes } = await import(require.resolve('../../../packages/slack-connector/src/manifest.js'));

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]] : []).filter(Boolean));
const port = Number(args.port ?? 8792);
const clientOrigin = args.client ?? 'http://127.0.0.1:5180';
const publicOrigin = `http://127.0.0.1:${port}`;
const signingSecret = 'qa-signing-secret';

const TS = n => `${1789171800 + n}.${String(100000 + n).padStart(6, '0')}`;
const message = (n, extra = {}) => ({ type: 'message', user: n % 3 === 0 ? 'U2' : 'U1', ts: TS(n), text: n === 3 ? 'hello *bold* &amp; <@U2> see <https://example.test|the docs>' : `Flow acceptance message ${n}`, client_msg_id: `cm-${n}`, team: 'T1', blocks: [{ type: 'rich_text', block_id: `b${n}`, elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text: `Flow acceptance message ${n}` }] }] }], ...extra });
const history = Array.from({ length: 17 }, (_, i) => message(i + 1, i + 1 === 5 ? { reply_count: 1, reply_users: ['U2'], latest_reply: TS(99), reactions: [{ name: 'white_check_mark', users: ['U2'], count: 1 }] } : i + 1 === 7 ? { files: [{ id: 'F1', name: 'notes.txt', mimetype: 'text/plain', size: 2048, created: 1789172215, user: 'U1' }] } : i + 1 === 9 ? { blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'a Block Kit section' } }] } : {})).reverse(); // newest first, like Slack
// Slack serves history newest-first by ts whatever order things were posted in.
const insert = (...rows) => { history.unshift(...rows); history.sort((a, b) => b.ts.localeCompare(a.ts)); };
// A posted message gets a real "now" ts: the connector reconciles an unknown
// outcome by looking for the author's text at or after the attempt.
const nowTs = () => `${Math.floor(Date.now() / 1000)}.${String(100000 + (++posted)).padStart(6, '0')}`;
let historyCalls = 0;
let rateLimitedUntil = 0;
let posted = 0;

const fetcher = async (url, request) => {
  const method = url.split('/').pop();
  const params = Object.fromEntries(new URLSearchParams(request.body));
  const json = (body, init) => new Response(JSON.stringify(body), init);
  switch (method) {
    case 'auth.test': return json({ ok: true, user_id: 'U1', user: 'alice', team_id: 'T1' });
    case 'users.conversations': return json({ ok: true, channels: [
      { id: 'C1', name: 'testing', is_channel: true, is_member: true, is_private: false, created: 1789170000, creator: 'U1', topic: { value: 'Flow acceptance channel' } },
      { id: 'D1', is_im: true, user: 'U2', created: 1789170001 },
      { id: 'G1', name: 'mpdm-alice--bob--carol-1', is_mpim: true, is_private: true, created: 1789170002 },
    ], response_metadata: { next_cursor: '' } });
    case 'users.list': return json({ ok: true, members: [
      { id: 'U1', name: 'alice', real_name: 'Alice Example', is_admin: false, profile: { display_name: 'alice', email: 'alice@example.test', image_72: 'https://avatars.example.test/alice.png', title: 'QA' } },
      { id: 'U2', name: 'bob', real_name: 'Bob Example', profile: { display_name: 'bob' } },
      { id: 'U3', name: 'carol', real_name: 'Carol Example', profile: {} },
    ], response_metadata: { next_cursor: '' } });
    case 'conversations.history': {
      historyCalls++;
      // The first request for the second page is refused with Retry-After: 5
      // (the measured one-per-minute budget, shortened); it succeeds 5 s later.
      if (params.cursor === 'page2') {
        if (!rateLimitedUntil) rateLimitedUntil = Date.now() + 5000;
        if (Date.now() < rateLimitedUntil) return json({ ok: false, error: 'ratelimited' }, { status: 429, headers: { 'retry-after': '5' } });
      }
      const limit = Math.min(15, Number(params.limit) || 15);
      // Like Slack, the cursor anchors on a position (the oldest ts of the
      // previous page), so messages posted meanwhile never shift the pages.
      const anchor = params.cursor && params.cursor !== 'page2' ? params.cursor.replace(/^before:/, '') : null;
      const older = anchor ? history.filter(m => m.ts < anchor) : (params.cursor === 'page2' ? history.slice(history.findIndex(m => m.ts === TS(3))) : history);
      const page = older.slice(0, limit);
      const hasMore = older.length > limit;
      return json({ ok: true, messages: page, has_more: hasMore, response_metadata: { next_cursor: hasMore ? (params.cursor ? `before:${page[page.length - 1].ts}` : 'page2') : '' } });
    }
    case 'conversations.replies': return params.ts === TS(5)
      ? json({ ok: true, messages: [message(5, { thread_ts: TS(5), reply_count: 1 }), message(99, { thread_ts: TS(5), user: 'U2', text: 'a reply from bob' })], has_more: false })
      : json({ ok: false, error: 'thread_not_found' });
    case 'chat.postMessage': {
      const ts = nowTs();
      const sent = { user: 'U1', type: 'message', text: params.text, ts, bot_id: 'B9', app_id: 'A1', bot_profile: { id: 'B9' }, ...(params.thread_ts ? { thread_ts: params.thread_ts } : {}) };
      if (!params.thread_ts) insert(sent); // Slack's history now has it too
      // The first send: Slack stored it, but the reply never made it back.
      // A 503 is what the connector treats as slack_unavailable -> unknown.
      if (posted === 1) { console.log(JSON.stringify({ unknownOutcome: params.text })); return new Response('upstream connect error', { status: 503 }); }
      return json({ ok: true, channel: params.channel, ts, message: sent });
    }
    case 'chat.update': {
      const row = history.find(m => m.ts === params.ts);
      if (row) { row.text = params.text; row.edited = { user: 'U1', ts: TS(300) }; }
      return json({ ok: true, channel: params.channel, ts: params.ts, text: params.text, message: { user: 'U1', type: 'message', text: params.text, edited: { user: 'U1', ts: TS(300) }, blocks: [] } });
    }
    case 'chat.delete': { const at = history.findIndex(m => m.ts === params.ts); if (at !== -1) history.splice(at, 1); return json({ ok: true, channel: params.channel, ts: params.ts }); }
    case 'reactions.add': case 'reactions.remove': case 'search.messages': case 'conversations.mark': return json({ ok: false, error: 'missing_scope', needed: 'reactions:write', provided: requestedScopes.join(',') });
    default: throw new Error(`fake Slack: unexpected method ${method}`);
  }
};

const store = new Store(':memory:', randomBytes(32).toString('base64'));
const connector = new Connector({ store, clientId: '1.2', clientSecret: 'qa-client-secret', publicOrigin, clientOrigins: [clientOrigin], signingSecret, fetcher });
// Seed the grant a real authorization would have written (scopes = the test app's real grant), plus one client session.
const grantId = opaque();
store.put('grant', grantId, { identity: { environment: 'slack', enterpriseId: null, teamId: 'T1', userId: 'U1' }, generation: 1, appId: 'A1', installationId: JSON.stringify(['A1', null, 'T1']), scopes: requestedScopes, accessToken: 'xoxp-fake', refreshToken: 'xoxe-fake', expiresAt: Date.now() + 12 * 3600_000, status: 'active', teamName: 'Acceptance Team', userName: 'alice' });
const credential = opaque();
store.put('session', hash(credential), { grantId, expiresAt: Date.now() + 30 * 86400_000 });

const server = createConnectorServer(connector);
server.listen(port, '127.0.0.1', () => {
  console.log(JSON.stringify({ ready: true, origin: publicOrigin, credential, teamId: 'T1', userId: 'U1', channelId: 'C1', threadTs: TS(5), liveTs: [TS(400), TS(401)] }));
});

// Events after 8 s: bob's second message first, then a malformed payload,
// then bob's first message. The browser must show them in ts order, and the
// malformed one must be dropped without breaking the stream.
const deliver = (eventId, payload) => {
  const event = { type: 'event_callback', event_id: eventId, team_id: 'T1', api_app_id: 'A1', authorizations: [{ user_id: 'U1', team_id: 'T1', is_bot: false }], event: payload };
  const raw = Buffer.from(JSON.stringify(event));
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = `v0=${createHmac('sha256', signingSecret).update(`v0:${timestamp}:`).update(raw).digest('hex')}`;
  return connector.event(raw, timestamp, signature);
};
setTimeout(() => {
  const first = message(400, { channel: 'C1', user: 'U2', text: 'live event one from bob' });
  const second = message(401, { channel: 'C1', user: 'U2', text: 'live event two from bob' });
  insert(first, second);
  deliver('Ev-acceptance-2', second);
  deliver('Ev-acceptance-bad', { type: 'message', subtype: 'message_changed', channel: 'C1', message: { ts: 'not-a-ts', text: 'drift' } });
  deliver('Ev-acceptance-1', first);
  console.log(JSON.stringify({ injected: ['live event two from bob', 'malformed', 'live event one from bob'] }));
}, 8000);

process.on('SIGINT', () => { server.close(); store.close(); process.exit(0); });
process.on('SIGTERM', () => { server.close(); store.close(); process.exit(0); });
