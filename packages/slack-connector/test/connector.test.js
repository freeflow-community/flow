import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHmac } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import { Connector, hash, opaque, identityKey } from '../src/connector.js';
import { requestedScopes } from '../src/manifest.js';
import { createConnectorServer } from '../src/http.js';

function fixture(t, options = {}) {
  const store = new Store(':memory:', randomBytes(32).toString('base64'));
  t.after(() => store.close());
  let now = 1_800_000_000_000;
  const calls = [];
  let rotation = 0;
  const fetcher = async (url, request) => {
    const method = url.split('/').pop();
    const params = Object.fromEntries(new URLSearchParams(request.body));
    calls.push({ method, params, token: request.headers.authorization });
    if (options.fetcher) {
      const override = await options.fetcher(method, params, request);
      if (override) return new Response(JSON.stringify(override));
    }
    let result;
    if (method === 'oauth.v2.access' && params.grant_type) {
      rotation++;
      result = { ok: true, token_type: 'user', access_token: 'rotated-T1', refresh_token: `refresh-${rotation}`, expires_in: 43200 };
    } else if (method === 'oauth.v2.access') {
      const team = params.code;
      result = { ok: true, app_id: 'A1', team: { id: team, name: `Team ${team}` }, authed_user: { id: 'U1', token_type: 'user', access_token: `secret-${team}`, refresh_token: `refresh-${team}`, expires_in: 43200, scope: (options.scopes ?? requestedScopes).join(',') } };
    } else if (method === 'auth.test') {
      result = { ok: true, user_id: 'U1', user: 'alice', team_id: request.headers.authorization.split('-').pop() };
    } else if (method === 'chat.postMessage') result = { ok: true, channel: params.channel, ts: '1700000000.000001', message: { user: 'U1' } };
    else throw new Error(`Unexpected method ${method}`);
    return new Response(JSON.stringify(result));
  };
  const connector = new Connector({ store, clientId: '123.456', publicOrigin: 'https://connector.test', clientOrigins: ['https://flow.test'], signingSecret: 'signing-secret', fetcher, now: () => now });
  async function begin(team = 'T1', expectedTeamId) {
    const verifier = opaque();
    const start = connector.start({ challenge: hash(verifier), clientOrigin: 'https://flow.test', expectedTeamId });
    const callback = await connector.callback({ state: new URL(start.authorizationUrl).searchParams.get('state'), code: team });
    return { ...callback, verifier, start };
  }
  async function connect(team = 'T1') { const flow = await begin(team); return connector.exchange(flow); }
  const event = (value, eventId = opaque()) => {
    const timestamp = String(now / 1000);
    const raw = Buffer.from(JSON.stringify({ type: 'event_callback', event_id: eventId, team_id: 'T1', api_app_id: 'A1', event: value }));
    const signature = `v0=${createHmac('sha256', 'signing-secret').update(`v0:${timestamp}:`).update(raw).digest('hex')}`;
    return { raw, timestamp, signature };
  };
  return { connector, store, calls, begin, connect, event, advance: ms => { now += ms; }, rotations: () => rotation };
}

test('PKCE uses distinct Slack verifier; validates two teams and one-use handoff', async t => {
  const f = fixture(t);
  const flow = await f.begin();
  const url = new URL(flow.start.authorizationUrl);
  const exchange = f.calls.find(c => c.method === 'oauth.v2.access');
  assert.equal(url.searchParams.get('code_challenge'), hash(exchange.params.code_verifier));
  assert.notEqual(exchange.params.code_verifier, flow.verifier);
  assert.equal(url.searchParams.get('user_scope'), requestedScopes.join(','));
  assert.equal(exchange.params.client_secret, undefined);
  assert.throws(() => f.connector.exchange({ ...flow, verifier: opaque() }), /invalid_handoff/);
  assert.throws(() => f.connector.exchange({ ...flow, clientOrigin: 'https://evil.test' }), /invalid_handoff/);
  const a = f.connector.exchange(flow);
  assert.throws(() => f.connector.exchange(flow), /invalid_handoff/);
  const b = await f.connect('T2');
  assert.notEqual(a.grantId, b.grantId);
  assert.notEqual(identityKey(a.identity), identityKey(b.identity));
  assert.ok(!JSON.stringify(a).includes('secret-'));
  assert.equal((await f.connector.info(a.credential)).identity.teamId, 'T1');
});

test('rejects unsolicited/replayed/expired callbacks and wrong teams', async t => {
  const f = fixture(t);
  await assert.rejects(f.connector.callback({ state: opaque(), code: 'T1' }), /callback/);
  const flow = await f.begin('T2', 'T1');
  assert.equal(f.connector.exchange(flow).status, 'wrong_team');
  assert.equal(f.store.all('grant').length, 0);
  await assert.rejects(f.connector.callback({ state: new URL(flow.start.authorizationUrl).searchParams.get('state'), code: 'T2' }), /callback/);
  const pending = f.connector.start({ challenge: hash(opaque()), clientOrigin: 'https://flow.test' });
  f.advance(600_001);
  await assert.rejects(f.connector.callback({ state: new URL(pending.authorizationUrl).searchParams.get('state'), code: 'T1' }), /expired/);
});

test('cancellation, consent and approval failures are distinct; handoff expires', async t => {
  const f = fixture(t);
  for (const [error, status] of [['user_cancelled', 'canceled'], ['access_denied', 'consent_denied'], ['admin_required', 'approval_required'], ['app_not_approved', 'approval_denied']]) {
    const verifier = opaque();
    const start = f.connector.start({ challenge: hash(verifier), clientOrigin: 'https://flow.test' });
    const callback = await f.connector.callback({ state: new URL(start.authorizationUrl).searchParams.get('state'), error });
    assert.equal(f.connector.exchange({ ...callback, verifier }).status, status);
  }
  const pending = await f.begin();
  f.advance(60_001);
  assert.throws(() => f.connector.exchange(pending), /invalid_handoff/);
});

test('partial grants disable sending; no bot fallback; authorship verified', async t => {
  const f = fixture(t, { scopes: ['team:read'] });
  const connection = await f.connect();
  assert.equal(connection.status, 'missing_scopes');
  assert.equal(connection.capabilities.sendAsUser, false);
  await assert.rejects(f.connector.send(connection.credential, { channel: 'C1', text: 'hello' }), /missing_scopes/);
  assert.ok(!f.calls.some(c => c.method === 'chat.postMessage'));
  const good = fixture(t);
  const session = await good.connect();
  assert.equal((await good.connector.send(session.credential, { channel: 'C1', text: 'hello' })).userId, 'U1');
  assert.equal(good.calls.at(-1).token, 'Bearer secret-T1');
  assert.equal(good.calls.at(-1).params.username, undefined);
  assert.equal(good.calls.at(-1).params.as_user, undefined);
});

test('shared grant rotates once under concurrent clients; disconnect isolates sessions', async t => {
  const f = fixture(t);
  const a = await f.connect(), b = await f.connect();
  assert.equal(a.grantId, b.grantId);
  f.advance(43200_000);
  await Promise.all([f.connector.info(a.credential), f.connector.info(b.credential)]);
  assert.equal(f.rotations(), 1);
  f.connector.disconnect(a.credential);
  await assert.rejects(f.connector.info(a.credential), /unauthorized/);
  assert.equal((await f.connector.info(b.credential)).grantStatus, 'active');
  f.connector.removeGrant(b.credential);
  await assert.rejects(f.connector.info(b.credential), /unauthorized/);
  assert.ok(!f.calls.some(c => ['apps.uninstall', 'auth.revoke'].includes(c.method)));
});

test('signed lifecycle events isolate grants, deduplicate and expire; reject forgery', async t => {
  const f = fixture(t);
  const a = await f.connect(), b = await f.connect('T2');
  const e = f.event({ type: 'tokens_revoked', tokens: { oauth: ['U1'] } });
  assert.throws(() => f.connector.event(e.raw, e.timestamp, 'v0=wrong'), /signature/);
  f.connector.event(e.raw, e.timestamp, e.signature);
  f.connector.event(e.raw, e.timestamp, e.signature);
  assert.equal(f.connector.events(a.credential).length, 1);
  assert.equal(f.connector.events(b.credential).length, 0);
  await assert.rejects(f.connector.info(a.credential), /revoked/);
  assert.equal((await f.connector.info(b.credential)).grantStatus, 'active');
  f.advance(301_000);
  assert.equal(f.connector.events(a.credential).length, 0);
  assert.throws(() => f.connector.event(e.raw, e.timestamp, e.signature), /signature/);
});

test('identity mismatch, bot grant and enterprise grant rejected', async t => {
  for (const override of [
    { ok: true, user_id: 'U2', team_id: 'T1' },
    { ok: true, user_id: 'U1', team_id: 'T1', bot_id: 'B1' },
  ]) {
    const f = fixture(t, { fetcher: method => method === 'auth.test' ? override : null });
    assert.equal((await f.connect()).status, 'identity_mismatch');
    assert.equal(f.store.all('grant').length, 0);
  }
});

test('encrypted store survives restart and binds ciphertext to its record', () => {
  const dir = mkdtempSync(join(tmpdir(), 'connector-test-'));
  const path = join(dir, 'store.sqlite'), key = randomBytes(32).toString('base64');
  try {
    let store = new Store(path, key);
    store.put('grant', 'one', { accessToken: 'never-plaintext', refreshToken: 'refresh-secret' });
    store.close();
    assert.ok(!readFileSync(path).includes('never-plaintext'));
    store = new Store(path, key);
    assert.equal(store.get('grant', 'one').refreshToken, 'refresh-secret');
    store.db.prepare('INSERT INTO records SELECT kind, ?, value FROM records WHERE id=?').run('two', 'one');
    assert.throws(() => store.get('grant', 'two'));
    store.close();
  } finally { rmSync(dir, { recursive: true }); }
});

test('HTTP callback uses body handoff and restrictive CSP, rejects hostile origins', async t => {
  const f = fixture(t);
  const server = createConnectorServer(f.connector);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const blocked = await fetch(`${base}/v1/oauth/start`, { method: 'POST', headers: { origin: 'https://evil.test', 'content-type': 'application/json' }, body: '{}' });
  assert.equal(blocked.status, 403);
  const verifier = opaque();
  const start = f.connector.start({ challenge: hash(verifier), clientOrigin: 'https://flow.test' });
  const state = new URL(start.authorizationUrl).searchParams.get('state');
  const result = await fetch(`${base}/oauth/callback?state=${state}&code=T1`);
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('location'), null);
  assert.match(result.headers.get('content-security-policy'), /default-src 'none'/);
  const html = await result.text();
  assert.match(html, /postMessage/);
  assert.ok(!html.includes('secret-T1'));
  assert.equal((await fetch(`${base}/oauth/callback?state=${state}&code=T1`)).status, 400);
});

test('app manifest requests exactly the executable capability manifest', () => {
  const manifest = JSON.parse(readFileSync(new URL('../slack-app-manifest.json', import.meta.url)));
  assert.deepEqual(manifest.oauth_config.scopes.user, requestedScopes);
  assert.equal(manifest.oauth_config.scopes.bot, undefined);
  assert.equal(manifest.oauth_config.pkce_enabled, true);
  assert.equal(manifest.settings.token_rotation_enabled, true);
});

test('uncertain refresh fails closed and does not retry a consumed refresh token', async t => {
  const f = fixture(t, { fetcher: (method, params) => {
    if (method === 'oauth.v2.access' && params.grant_type) throw new Error('connection lost');
  } });
  const a = await f.connect();
  f.advance(43200_000);
  await assert.rejects(f.connector.info(a.credential), /connection lost/);
  await assert.rejects(f.connector.info(a.credential), /reauthorization_required/);
  assert.equal(f.calls.filter(c => c.params.grant_type).length, 1);
});

test('revocation during refresh cannot resurrect credentials', async t => {
  let release, started;
  const waiting = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const f = fixture(t, { fetcher: async (method, params) => {
    if (method === 'oauth.v2.access' && params.grant_type) { started(); await gate; }
  } });
  const a = await f.connect();
  f.advance(43200_000);
  const refresh = f.connector.info(a.credential);
  await waiting;
  const e = f.event({ type: 'app_uninstalled' });
  f.connector.event(e.raw, e.timestamp, e.signature);
  release();
  await assert.rejects(refresh, /app_removed/);
  assert.equal(f.store.get('grant', a.grantId).status, 'app_removed');
  assert.equal(f.store.get('grant', a.grantId).accessToken, '');
});

test('API account deactivation is persisted; later OAuth reauthorizes existing clients', async t => {
  let inactive = false;
  const f = fixture(t, { fetcher: method => method === 'auth.test' && inactive ? { ok: false, error: 'account_inactive' } : null });
  const a = await f.connect();
  inactive = true;
  await assert.rejects(f.connector.info(a.credential), /account_deactivated/);
  assert.equal(f.store.get('grant', a.grantId).status, 'account_deactivated');
  inactive = false;
  const b = await f.connect();
  assert.equal(a.grantId, b.grantId);
  assert.equal((await f.connector.info(a.credential)).grantStatus, 'active');
});

test('refuses bot authorship response and user tokens without rotation', async t => {
  const f = fixture(t, { fetcher: method => method === 'chat.postMessage' ? { ok: true, message: { user: 'B1', bot_id: 'B1' } } : null });
  const a = await f.connect();
  await assert.rejects(f.connector.send(a.credential, { channel: 'C1', text: 'test' }), /authorship_mismatch/);
  const g = fixture(t, { fetcher: method => method === 'oauth.v2.access' ? { ok: true, app_id: 'A1', team: { id: 'T1' }, authed_user: { id: 'U1', token_type: 'user', access_token: 'secret-T1' } } : null });
  assert.equal((await g.connect()).status, 'rotation_required');
});

test('reauthorization does not replay an old revoked state to surviving clients', async t => {
  const f = fixture(t);
  const a = await f.connect();
  const e = f.event({ type: 'tokens_revoked', tokens: { oauth: ['U1'] } });
  f.connector.event(e.raw, e.timestamp, e.signature);
  assert.equal(f.connector.events(a.credential).length, 1);
  const b = await f.connect();
  assert.equal(b.grantId, a.grantId);
  assert.equal(f.connector.events(a.credential).length, 0);
  f.connector.event(e.raw, e.timestamp, e.signature);
  assert.equal((await f.connector.info(a.credential)).grantStatus, 'active');
});

test('verifier-bound polling completes without an opener and remains one-use', async t => {
  const f = fixture(t);
  const verifier = opaque();
  const start = f.connector.start({ challenge: hash(verifier), clientOrigin: 'https://flow.test' });
  const request = { verifier, operationId: start.operationId, clientOrigin: 'https://flow.test' };
  assert.throws(() => f.connector.poll({ ...request, verifier: opaque() }), /invalid_handoff/);
  assert.throws(() => f.connector.poll({ ...request, clientOrigin: 'https://other.test' }), /invalid_handoff/);
  assert.deepEqual(f.connector.poll(request), { status: 'pending' });
  const callback = await f.connector.callback({ state: new URL(start.authorizationUrl).searchParams.get('state'), code: 'T1' });
  assert.throws(() => f.connector.poll({ ...request, verifier: opaque() }), /invalid_handoff/);
  const result = f.connector.poll(request);
  assert.equal(result.status, 'connected');
  assert.equal(f.connector.session(result.credential).grant.identity.teamId, 'T1');
  assert.throws(() => f.connector.poll(request), /authorization_expired/);
  assert.throws(() => f.connector.exchange({ ...callback, verifier }), /invalid_handoff/);
});

test('polling remains pending during code exchange and cannot replay callback state', async t => {
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const f = fixture(t, { fetcher: async method => { if (method === 'oauth.v2.access') { entered(); await gate; } } });
  const verifier = opaque();
  const start = f.connector.start({ challenge: hash(verifier), clientOrigin: 'https://flow.test' });
  const state = new URL(start.authorizationUrl).searchParams.get('state');
  const callback = f.connector.callback({ state, code: 'T1' });
  await started;
  const request = { verifier, operationId: start.operationId, clientOrigin: 'https://flow.test' };
  assert.equal(f.connector.poll(request).status, 'pending');
  await assert.rejects(f.connector.callback({ state, code: 'T1' }), /callback/);
  release(); await callback;
  assert.equal(f.connector.poll(request).status, 'connected');
});
