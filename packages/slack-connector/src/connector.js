import { createHash, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';
import { markdownToMrkdwn } from '@flow/shared';
import { requestedScopes, grantedCapabilities } from './manifest.js';
import { isTs, normalizeChannel, normalizeEvent, normalizeMember, normalizeMessage, normalizeWorkspace } from './normalize.js';

export const opaque = () => randomBytes(32).toString('base64url');
export const hash = value => createHash('sha256').update(value).digest('base64url');
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export class Fault extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
export const identityKey = ({ environment, enterpriseId, teamId, userId }) => JSON.stringify([environment, enterpriseId ?? null, teamId, userId]);
const idPattern = /^[A-Z][A-Z0-9]+$/;
const terminal = new Map([['token_revoked', 'revoked'], ['invalid_auth', 'reauthorization_required'], ['account_inactive', 'account_deactivated'], ['token_expired', 'reauthorization_required']]);

export class Connector {
  constructor({ store, clientId, clientSecret, publicOrigin, clientOrigins, signingSecret, fetcher = fetch, now = Date.now }) {
    Object.assign(this, { store, clientId, clientSecret, publicOrigin, clientOrigins, signingSecret, fetcher, now });
    this.locks = new Map();
    this.rateLimits = new Map();
  }
  async locked(key, fn) {
    const previous = this.locks.get(key) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(fn);
    this.locks.set(key, current);
    try { return await current; } finally { if (this.locks.get(key) === current) this.locks.delete(key); }
  }
  sweep() {
    const now = this.now();
    for (const kind of ['oauth', 'handoff', 'session', 'event', 'stream']) {
      for (const { id, value } of this.store.all(kind)) if (value.expiresAt <= now) this.store.remove(kind, id);
    }
    for (const [key, expiresAt] of this.rateLimits) if (expiresAt <= now) this.rateLimits.delete(key);
  }
  start({ challenge, clientOrigin, expectedTeamId }) {
    this.sweep();
    if (!this.clientOrigins.includes(clientOrigin)) throw new Fault('client_origin_not_allowed');
    if (!/^[A-Za-z0-9_-]{43}$/.test(challenge ?? '')) throw new Fault('invalid_challenge');
    if (expectedTeamId && !idPattern.test(expectedTeamId)) throw new Fault('invalid_team');
    if (this.store.all('oauth').length >= 1000) throw new Fault('busy', 429);
    const state = opaque(), verifier = opaque(), operationId = opaque();
    this.store.put('oauth', hash(state), { challenge, clientOrigin, expectedTeamId, verifier, operationId, expiresAt: this.now() + 600_000 });
    const url = new URL('https://slack.com/oauth/v2/authorize');
    for (const [key, value] of Object.entries({ client_id: this.clientId, user_scope: requestedScopes.join(','), redirect_uri: `${this.publicOrigin}/oauth/callback`, state, code_challenge: hash(verifier), code_challenge_method: 'S256' })) url.searchParams.set(key, value);
    if (expectedTeamId) url.searchParams.set('team', expectedTeamId);
    return { authorizationUrl: url.href, operationId };
  }
  async slack(method, parameters, token) {
    const response = await this.fetcher(`https://slack.com/api/${method}`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: new URLSearchParams(parameters),
    });
    if (response.status === 429) {
      const error = new Fault('rate_limited', 429);
      error.retryAfter = Math.min(3600, Math.max(1, Number(response.headers.get('retry-after')) || 60));
      throw error;
    }
    if (!response.ok) throw new Fault('slack_unavailable', 502);
    const result = await response.json();
    if (!result.ok) {
      const fault = new Fault(terminal.get(result.error) ?? ({ missing_scope: 'missing_scopes', invalid_refresh_token: 'reauthorization_required', bad_client_secret: 'connector_misconfigured', invalid_client_id: 'connector_misconfigured', channel_not_found: 'not_found', message_not_found: 'not_found', thread_not_found: 'not_found', cant_update_message: 'forbidden', cant_delete_message: 'forbidden', not_in_channel: 'forbidden', is_archived: 'forbidden', msg_too_long: 'invalid_message' }[result.error]) ?? 'slack_request_failed', { not_found: 404, forbidden: 403, missing_scopes: 403 }[terminal.get(result.error) ?? ({ channel_not_found: 'not_found', message_not_found: 'not_found', thread_not_found: 'not_found', cant_update_message: 'forbidden', cant_delete_message: 'forbidden', not_in_channel: 'forbidden', is_archived: 'forbidden', missing_scope: 'missing_scopes' }[result.error])] ?? 400);
      // The Slack error code stays on the fault for callers that treat some
      // codes as benign (already_reacted); it is never serialized to clients.
      fault.slackError = result.error;
      throw fault;
    }
    return result;
  }
  // ---- public-API baseline (#545): read + mutations behind the grant ----------
  // Rate budgets belong to app + team + method and are shared by every client
  // session of that team (spec "Public API baseline"). A 429 from Slack parks
  // the budget until Retry-After; a parked budget answers 429 locally with the
  // remaining wait, so concurrent sessions do not each burn a call.
  budgetKey(grant, method) { return JSON.stringify([grant.identity.teamId, method]); }
  async call(grant, method, parameters) {
    const budget = this.budgetKey(grant, method);
    const until = this.rateLimits.get(budget) ?? 0;
    if (until > this.now()) { const fault = new Fault('rate_limited', 429); fault.retryAfter = Math.max(1, Math.ceil((until - this.now()) / 1000)); throw fault; }
    try { return await this.slack(method, parameters, grant.accessToken); } catch (error) {
      if (error.retryAfter) this.rateLimits.set(budget, this.now() + error.retryAfter * 1000);
      throw error;
    }
  }
  requireCapability(grant, name) { if (!grantedCapabilities(grant.scopes)[name]) throw new Fault('missing_scopes', 403); }
  async paged(grant, method, parameters, pick, maxPages = 5) {
    const rows = [];
    let cursor;
    for (let page = 0; page < maxPages; page++) {
      const result = await this.call(grant, method, { ...parameters, ...(cursor ? { cursor } : {}) });
      rows.push(...(pick(result) ?? []));
      cursor = result.response_metadata?.next_cursor || '';
      if (!cursor) break;
    }
    return rows;
  }
  async workspace(credential) {
    return this.withGrant(credential, async grant => normalizeWorkspace(grant));
  }
  async conversations(credential) {
    return this.withGrant(credential, async grant => {
      this.requireCapability(grant, 'readConversations');
      const rows = await this.paged(grant, 'users.conversations', { types: 'public_channel,private_channel,mpim,im', exclude_archived: 'true', limit: '200' }, r => r.channels);
      return rows.map(c => normalizeChannel(c, { teamId: grant.identity.teamId, selfUserId: grant.identity.userId }));
    });
  }
  async members(credential) {
    return this.withGrant(credential, async grant => {
      this.requireCapability(grant, 'readConversations');
      const rows = await this.paged(grant, 'users.list', { limit: '200' }, r => r.members);
      return rows.map(normalizeMember).filter(m => !m.deleted).map(({ deleted, ...m }) => m);
    });
  }
  static cursorOk(cursor) { return cursor == null || cursor === '' || (typeof cursor === 'string' && /^[A-Za-z0-9=_-]{1,512}$/.test(cursor)); }
  async history(credential, { channel, cursor, limit }) {
    if (!idPattern.test(channel ?? '') || !Connector.cursorOk(cursor)) throw new Fault('invalid_request');
    const size = Math.min(200, Math.max(1, Number(limit) || 50));
    return this.withGrant(credential, async grant => {
      this.requireCapability(grant, 'readHistory');
      const result = await this.call(grant, 'conversations.history', { channel, limit: String(size), ...(cursor ? { cursor } : {}) });
      const messages = (result.messages ?? []).filter(m => isTs(m.ts)).map(m => normalizeMessage(m, { teamId: grant.identity.teamId, channelId: channel })).reverse();
      const next = result.response_metadata?.next_cursor || null;
      // Slack may cap the page below what was asked (15 for restricted apps);
      // a short page with more behind it is visibly partial, not complete.
      return { messages, cursor: result.has_more ? next : null, partial: Boolean(result.has_more) && messages.length < size };
    });
  }
  async replies(credential, { channel, ts, cursor }) {
    if (!idPattern.test(channel ?? '') || !isTs(ts) || !Connector.cursorOk(cursor)) throw new Fault('invalid_request');
    return this.withGrant(credential, async grant => {
      this.requireCapability(grant, 'readHistory');
      const result = await this.call(grant, 'conversations.replies', { channel, ts, limit: '200', ...(cursor ? { cursor } : {}) });
      const all = (result.messages ?? []).filter(m => isTs(m.ts)).map(m => normalizeMessage(m, { teamId: grant.identity.teamId, channelId: channel }));
      const root = all.find(m => m.id === ts) ?? null;
      if (!root) throw new Fault('not_found', 404);
      return { root, replies: all.filter(m => m.id !== ts), cursor: result.has_more ? result.response_metadata?.next_cursor || null : null, partial: Boolean(result.has_more) };
    });
  }
  async update(credential, { channel, ts, text }) {
    if (!idPattern.test(channel ?? '') || !isTs(ts) || typeof text !== 'string' || !text.trim() || text.length > 4000) throw new Fault('invalid_message');
    return this.withGrant(credential, async grant => {
      this.requireCapability(grant, 'sendAsUser');
      const result = await this.call(grant, 'chat.update', { channel, ts, text: markdownToMrkdwn(text) });
      return normalizeMessage({ ...result.message, ts: result.ts, channel: result.channel }, { teamId: grant.identity.teamId, channelId: result.channel ?? channel });
    });
  }
  async remove(credential, { channel, ts }) {
    if (!idPattern.test(channel ?? '') || !isTs(ts)) throw new Fault('invalid_request');
    return this.withGrant(credential, async grant => {
      this.requireCapability(grant, 'sendAsUser');
      await this.call(grant, 'chat.delete', { channel, ts });
      return { ok: true };
    });
  }
  async reaction(credential, { channel, ts, name, on }) {
    if (!idPattern.test(channel ?? '') || !isTs(ts) || typeof name !== 'string' || !/^[a-z0-9_+-]{1,64}(::skin-tone-[2-6])?$/.test(name)) throw new Fault('invalid_request');
    return this.withGrant(credential, async grant => {
      this.requireCapability(grant, 'reactions');
      try { await this.call(grant, on ? 'reactions.add' : 'reactions.remove', { channel, timestamp: ts, name }); } catch (error) {
        if (!['already_reacted', 'no_reaction'].includes(error.slackError)) throw error;
      }
      return { ok: true };
    });
  }
  async markRead(credential, { channel, ts }) {
    if (!idPattern.test(channel ?? '') || !isTs(ts)) throw new Fault('invalid_request');
    return this.withGrant(credential, async grant => {
      this.requireCapability(grant, 'readState');
      await this.call(grant, 'conversations.mark', { channel, ts });
      return { ok: true };
    });
  }
  async search(credential, { query, cursor }) {
    if (typeof query !== 'string' || !query.trim() || query.length > 500 || !Connector.cursorOk(cursor)) throw new Fault('invalid_request');
    return this.withGrant(credential, async grant => {
      this.requireCapability(grant, 'search');
      const result = await this.call(grant, 'search.messages', { query, count: '20', ...(cursor ? { cursor } : {}) });
      const matches = result.messages?.matches ?? [];
      return { messages: matches.filter(m => isTs(m.ts) && m.channel?.id).map(m => normalizeMessage(m, { teamId: grant.identity.teamId, channelId: m.channel.id })), cursor: result.messages?.pagination?.next_cursor || null, partial: Boolean(result.messages?.pagination?.next_cursor) };
    });
  }
  /** Chat events the Events API delivered for this grant since `since` (a
   * sequence number from a previous call). Retention is bounded (5 minutes,
   * 1000 rows); a client that falls behind gets `gap: true` and refetches. */
  stream(credential, since) {
    const { session, grant } = this.session(credential);
    this.sweep();
    const from = Number(since) || 0;
    const rows = this.store.all('stream').filter(row => row.value.grantId === session.grantId && row.value.generation === grant.generation).sort((a, b) => a.value.seq - b.value.seq);
    const oldest = rows[0]?.value.seq ?? null;
    return { events: rows.filter(row => row.value.seq > from).map(row => row.value.event), seq: rows.length ? rows[rows.length - 1].value.seq : from, gap: from > 0 && oldest != null && oldest > from + 1 };
  }
  async callback({ state, code, error }) {
    if (typeof state !== 'string') throw new Fault('unsolicited_callback');
    const pending = this.store.transaction(() => {
      const value = this.store.get('oauth', hash(state));
      if (!value || value.consumed || value.expiresAt <= this.now()) throw new Fault('unsolicited_or_expired_callback');
      this.store.put('oauth', hash(state), { ...value, consumed: true });
      return value;
    });
    let outcome;
    if (error) {
      outcome = { status: ({ access_denied: 'consent_denied', user_cancelled: 'canceled', admin_required: 'approval_required', app_not_approved: 'approval_denied', restricted_action: 'approval_denied' })[error] ?? 'authorization_failed' };
    } else {
      try {
        if (typeof code !== 'string' || !code || code.length > 2048) throw new Fault('invalid_code');
        const oauth = await this.slack('oauth.v2.access', { client_id: this.clientId, code, code_verifier: pending.verifier, redirect_uri: `${this.publicOrigin}/oauth/callback` });
        const user = oauth.authed_user;
        if (oauth.app_id == null || user?.token_type !== 'user' || !user.access_token || !idPattern.test(user.id ?? '')) throw new Fault('invalid_user_grant');
        // Never infer org-wide access from enterprise_id. This PoC only accepts
        // concrete workspace grants verified with the returned USER token.
        if (oauth.is_enterprise_install || !idPattern.test(oauth.team?.id ?? '')) throw new Fault('enterprise_grant_unsupported');
        const verified = await this.slack('auth.test', {}, user.access_token);
        if (verified.user_id !== user.id || verified.team_id !== oauth.team.id || verified.bot_id || (verified.enterprise_id ?? null) !== (oauth.enterprise?.id ?? null)) throw new Fault('identity_mismatch');
        if (pending.expectedTeamId && pending.expectedTeamId !== verified.team_id) throw new Fault('wrong_team');
        if (!user.refresh_token || !Number.isFinite(user.expires_in) || user.expires_in <= 0) throw new Fault('rotation_required');
        const identity = { environment: 'slack', enterpriseId: oauth.enterprise?.id ?? null, teamId: verified.team_id, userId: verified.user_id };
        const key = identityKey(identity);
        const scopes = typeof user.scope === 'string' ? user.scope.split(',').filter(Boolean) : [];
        const grantId = await this.locked(key, () => {
          const existing = this.store.all('grant').find(row => identityKey(row.value.identity) === key);
          const id = existing?.id ?? opaque();
          this.store.put('grant', id, { identity, generation: (existing?.value.generation ?? 0) + 1, appId: oauth.app_id, installationId: JSON.stringify([oauth.app_id, identity.enterpriseId, identity.teamId]), scopes, accessToken: user.access_token, refreshToken: user.refresh_token, expiresAt: this.now() + user.expires_in * 1000, status: 'active', teamName: oauth.team.name ?? verified.team_id, userName: verified.user ?? verified.user_id });
          return id;
        });
        outcome = { status: requestedScopes.every(scope => scopes.includes(scope)) ? 'connected' : 'missing_scopes', grantId };
      } catch (failure) {
        outcome = { status: failure instanceof Fault ? failure.code : 'slack_unavailable' };
      }
    }
    const handoff = opaque();
    this.store.put('handoff', hash(handoff), { ...outcome, challenge: pending.challenge, clientOrigin: pending.clientOrigin, operationId: pending.operationId, expiresAt: this.now() + 60_000 });
    this.store.remove('oauth', hash(state));
    // Sent only in an HTTPS response body/postMessage, never query or fragment.
    return { clientOrigin: pending.clientOrigin, operationId: pending.operationId, handoff };
  }
  exchange({ handoff, verifier, operationId, clientOrigin }) {
    if (typeof handoff !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(verifier ?? '')) throw new Fault('invalid_handoff');
    return this.redeem(hash(handoff), { verifier, operationId, clientOrigin });
  }
  poll({ verifier, operationId, clientOrigin }) {
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(verifier ?? '') || typeof operationId !== 'string') throw new Fault('invalid_handoff');
    const completed = this.store.all('handoff').find(row => row.value.operationId === operationId);
    if (completed) return this.redeem(completed.id, { verifier, operationId, clientOrigin });
    const pending = this.store.all('oauth').find(row => row.value.operationId === operationId)?.value;
    if (!pending || pending.expiresAt <= this.now()) throw new Fault('authorization_expired');
    if (pending.clientOrigin !== clientOrigin || !same(pending.challenge, hash(verifier))) throw new Fault('invalid_handoff');
    return { status: 'pending' };
  }
  redeem(key, { verifier, operationId, clientOrigin }) {
    return this.store.transaction(() => {
      const pending = this.store.get('handoff', key);
      if (!pending || pending.expiresAt <= this.now() || pending.clientOrigin !== clientOrigin || pending.operationId !== operationId || !same(pending.challenge, hash(verifier))) throw new Fault('invalid_handoff');
      this.store.remove('handoff', key);
      if (!pending.grantId) return { status: pending.status };
      const grant = this.store.get('grant', pending.grantId);
      if (!grant || grant.status !== 'active') throw new Fault('reauthorization_required', 401);
      const credential = opaque();
      this.store.put('session', hash(credential), { grantId: pending.grantId, expiresAt: this.now() + 30 * 86400_000 });
      return { status: pending.status, credential, ...this.describe(pending.grantId, grant) };
    });
  }
  session(credential) {
    if (typeof credential !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(credential)) throw new Fault('unauthorized', 401);
    const session = this.store.get('session', hash(credential));
    if (!session || session.expiresAt <= this.now()) throw new Fault('unauthorized', 401);
    const grant = this.store.get('grant', session.grantId);
    if (!grant) throw new Fault('reauthorization_required', 401);
    return { session, grant };
  }
  describe(grantId, grant) {
    return { grantId, identity: grant.identity, teamName: grant.teamName, userName: grant.userName, scopes: grant.scopes, capabilities: grantedCapabilities(grant.scopes), grantStatus: grant.status };
  }
  disconnect(credential) { this.session(credential); this.store.remove('session', hash(credential)); }
  removeGrant(credential) {
    const { session } = this.session(credential);
    this.store.transaction(() => {
      this.store.remove('grant', session.grantId);
      for (const row of this.store.all('session')) if (row.value.grantId === session.grantId) this.store.remove('session', row.id);
      for (const row of this.store.all('event')) if (row.value.grantId === session.grantId) this.store.remove('event', row.id);
    });
    // Intentionally no apps.uninstall or auth.revoke: removing the local grant
    // must not revoke a shared Slack app/user installation outside this connector.
  }
  async withGrant(credential, fn) {
    const { session } = this.session(credential);
    const original = this.store.get('grant', session.grantId);
    return this.locked(identityKey(original.identity), async () => {
      // Re-check after waiting: a disconnect/removal must not resurrect a grant.
      this.session(credential);
      let grant = this.store.get('grant', session.grantId);
      if (grant.status !== 'active') throw new Fault(grant.status, 401);
      try {
        if (grant.expiresAt <= this.now() + 60_000) {
          // Persist a fail-closed marker BEFORE consuming the one-use refresh
          // token. An uncertain network failure/crash requires reauthorization.
          this.store.put('grant', session.grantId, { ...grant, status: 'reauthorization_required' });
          // Slack's PKCE guide says refresh needs no secret, but live Slack answers
          // bad_client_secret without one. Sign-in itself stays secret-free PKCE.
          const rotated = await this.slack('oauth.v2.access', { client_id: this.clientId, client_secret: this.clientSecret, grant_type: 'refresh_token', refresh_token: grant.refreshToken });
          if (rotated.token_type !== 'user' || !rotated.access_token || !rotated.refresh_token || !(rotated.expires_in > 0)) throw new Fault('reauthorization_required', 401);
          const current = this.store.get('grant', session.grantId);
          if (!current || current.status !== 'reauthorization_required') throw new Fault(current?.status ?? 'reauthorization_required', 401);
          grant = { ...grant, accessToken: rotated.access_token, refreshToken: rotated.refresh_token, expiresAt: this.now() + rotated.expires_in * 1000, ...(typeof rotated.scope === 'string' ? { scopes: rotated.scope.split(',') } : {}) };
          this.store.put('grant', session.grantId, grant);
        }
        return await fn(grant, session.grantId);
      } catch (error) {
        if (['revoked', 'reauthorization_required', 'account_deactivated'].includes(error.code) && this.store.get('grant', session.grantId)) this.store.put('grant', session.grantId, { ...grant, status: error.code, accessToken: '', refreshToken: '' });
        throw error;
      }
    });
  }
  async info(credential) {
    return this.withGrant(credential, async (grant, id) => {
      const result = await this.slack('auth.test', {}, grant.accessToken);
      if (result.team_id !== grant.identity.teamId || result.user_id !== grant.identity.userId || result.bot_id) throw new Fault('identity_mismatch');
      return this.describe(id, grant);
    });
  }
  async send(credential, { channel, text, thread_ts: threadTs }) {
    if (!idPattern.test(channel ?? '') || typeof text !== 'string' || !text.trim() || text.length > 4000 || (threadTs != null && !isTs(threadTs))) throw new Fault('invalid_message');
    return this.withGrant(credential, async grant => {
      if (!grantedCapabilities(grant.scopes).sendAsUser) throw new Fault('missing_scopes', 403);
      const budget = JSON.stringify([grant.identity.teamId, 'chat.postMessage']);
      if ((this.rateLimits.get(budget) ?? 0) > this.now()) throw new Fault('rate_limited', 429);
      try {
        // The body arrives as Flow markdown and goes out as mrkdwn; the reply
        // comes back through the same normalizer every read path uses.
        const result = await this.slack('chat.postMessage', { channel, text: markdownToMrkdwn(text), unfurl_links: 'false', unfurl_media: 'false', ...(threadTs ? { thread_ts: threadTs } : {}) }, grant.accessToken);
        // Slack stamps the app's bot_id/app_id/bot_profile on user-token posts
        // too, so authorship is message.user; a bot_message is never the user's.
        // 409, not 5xx: a proxy may replace a 5xx body and hide this code.
        if (result.message?.user !== grant.identity.userId || result.message?.subtype === 'bot_message') throw new Fault('authorship_mismatch', 409);
        const message = normalizeMessage({ ...result.message, ts: result.ts, channel: result.channel, ...(threadTs ? { thread_ts: threadTs } : {}) }, { teamId: grant.identity.teamId, channelId: result.channel ?? channel });
        return { channel: result.channel, ts: result.ts, userId: result.message.user, message };
      } catch (error) {
        if (error.retryAfter) this.rateLimits.set(budget, this.now() + error.retryAfter * 1000);
        throw error;
      }
    });
  }
  event(raw, timestamp, signature) {
    if (!/^\d+$/.test(timestamp ?? '') || Math.abs(this.now() / 1000 - Number(timestamp)) > 300) throw new Fault('invalid_signature', 401);
    const expected = `v0=${createHmac('sha256', this.signingSecret).update(`v0:${timestamp}:`).update(raw).digest('hex')}`;
    if (!same(expected, signature)) throw new Fault('invalid_signature', 401);
    const envelope = JSON.parse(raw.toString());
    if (envelope.type === 'url_verification') return { challenge: envelope.challenge };
    if (envelope.type !== 'event_callback' || typeof envelope.event_id !== 'string') throw new Fault('invalid_event');
    const event = envelope.event;
    if (!['tokens_revoked', 'app_uninstalled'].includes(event?.type)) return this.streamEvent(envelope);
    this.sweep();
    this.store.transaction(() => {
      for (const { id, value: grant } of this.store.all('grant')) {
        if (grant.appId !== envelope.api_app_id || grant.identity.teamId !== envelope.team_id) continue;
        if (event.type === 'tokens_revoked' && !event.tokens?.oauth?.includes(grant.identity.userId)) continue;
        const eventId = hash(JSON.stringify([envelope.event_id, id]));
        if (this.store.get('event', eventId)) continue;
        const status = event.type === 'app_uninstalled' ? 'app_removed' : 'revoked';
        this.store.put('grant', id, { ...grant, status, accessToken: '', refreshToken: '' });
        this.store.put('event', eventId, { grantId: id, generation: grant.generation, eventId: envelope.event_id, status, expiresAt: this.now() + 300_000 });
      }
      const rows = this.store.all('event');
      for (const row of rows.slice(0, Math.max(0, rows.length - 1000))) this.store.remove('event', row.id);
    });
    return { ok: true };
  }
  /** Route a chat event to the grants Slack says are authorized for it — the
   * `authorizations` list names installing users who can see the event —
   * never to every grant on the team. Stored per grant with bounded retention. */
  streamEvent(envelope) {
    const normalized = normalizeEvent(envelope.event, { teamId: envelope.team_id });
    if (!normalized) return { ok: true };
    const authorized = new Set((envelope.authorizations ?? []).filter(a => !a.is_bot && typeof a.user_id === 'string').map(a => a.user_id));
    if (!authorized.size) return { ok: true };
    this.sweep();
    this.store.transaction(() => {
      for (const { id, value: grant } of this.store.all('grant')) {
        if (grant.appId !== envelope.api_app_id || grant.identity.teamId !== envelope.team_id || grant.status !== 'active' || !authorized.has(grant.identity.userId)) continue;
        const rowId = hash(JSON.stringify([envelope.event_id, id, 'stream']));
        if (this.store.get('stream', rowId)) continue;
        this.streamSeq = (this.streamSeq ?? 0) + 1;
        this.store.put('stream', rowId, { grantId: id, generation: grant.generation, seq: this.streamSeq, event: normalized, expiresAt: this.now() + 300_000 });
      }
      const rows = this.store.all('stream');
      for (const row of rows.slice(0, Math.max(0, rows.length - 1000))) this.store.remove('stream', row.id);
    });
    return { ok: true };
  }
  events(credential) {
    const { session, grant } = this.session(credential);
    this.sweep();
    return this.store.all('event').filter(row => row.value.grantId === session.grantId && row.value.generation === grant.generation).map(row => ({ eventId: row.value.eventId, status: row.value.status }));
  }
}
