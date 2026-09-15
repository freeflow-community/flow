import { createHash, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';
import { markdownToMrkdwn, EMOJI_SHORTCODES } from '@flow/shared';
import { requestedScopes, grantedCapabilities } from './manifest.js';
import { SLACK_EMOJI, botMember, isTs, tsToIso, normalizeChannel, normalizeEvent, normalizeMember, normalizeMessage, normalizeWorkspace, slackThumbUrl } from './normalize.js';

export const opaque = () => randomBytes(32).toString('base64url');
export const hash = value => createHash('sha256').update(value).digest('base64url');
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export class Fault extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
export const identityKey = ({ environment, enterpriseId, teamId, userId }) => JSON.stringify([environment, enterpriseId ?? null, teamId, userId]);
const idPattern = /^[A-Z][A-Z0-9]+$/;
const fileIdPattern = /^F[A-Z0-9]{6,20}$/;
export const emojiNamePattern = /^[a-z0-9_+'.-]{1,100}$/;
// Hosts the connector will fetch bytes from. Files need the user token; custom
// emoji images are public, so the token is never sent there.
const SLACK_FILE_HOST = 'https://files.slack.com/';
const SLACK_EMOJI_HOST = 'https://emoji.slack-edge.com/';
const SLACK_UPLOAD_HOST = 'https://files.slack.com/upload/';
const SLACK_AVATAR_HOST = 'https://avatars.slack-edge.com/';
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
const terminal = new Map([['token_revoked', 'revoked'], ['invalid_auth', 'reauthorization_required'], ['account_inactive', 'account_deactivated'], ['token_expired', 'reauthorization_required']]);

export class Connector {
  constructor({ store, clientId, clientSecret, publicOrigin, clientOrigins, signingSecret, fetcher = fetch, now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
    Object.assign(this, { store, clientId, clientSecret, publicOrigin, clientOrigins, signingSecret, fetcher, now, sleep });
    this.locks = new Map();
    this.rateLimits = new Map();
    /** [grantId, fileId] -> Slack file object seen in a read for that grant, so a
     * preview does not cost a files.info call. Bounded; oldest dropped first. */
    this.fileRefs = new Map();
    /** teamId -> { names: Map(name -> image url), expiresAt } from emoji.list. */
    this.emojiCache = new Map();
    /** teamId -> { url, expiresAt } from team.info. */
    this.teamIcons = new Map();
    /** grantId -> { channels: ids in check order, seenAt } from the grant's last
     * conversation list: what the activity check walks, and who else a
     * channel's message counts for. */
    this.activityTargets = new Map();
    /** teamId -> when a person last loaded history, so the background check
     * never competes with someone reading. */
    this.historyReadAt = new Map();
    /** teamId -> Map(bot id -> member row) for apps seen posting (no users.list row). */
    this.bots = new Map();
  }
  async locked(key, fn) {
    const previous = this.locks.get(key) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(fn);
    this.locks.set(key, current);
    try { return await current; } finally { if (this.locks.get(key) === current) this.locks.delete(key); }
  }
  sweep() {
    const now = this.now();
    for (const kind of ['oauth', 'handoff', 'session', 'event', 'stream', 'sent', 'upload', 'activity']) {
      for (const { id, value } of this.store.all(kind)) if (value.expiresAt <= now) this.store.remove(kind, id);
    }
    for (const [key, expiresAt] of this.rateLimits) if (expiresAt <= now) this.rateLimits.delete(key);
  }
  /** A configured client origin with the app's own URL scheme (`flow://…`):
   * a native client, which cannot send an Origin header. */
  isNativeOrigin(value) { return typeof value === 'string' && /^flow:\/\/[a-z0-9.-]+$/i.test(value) && this.clientOrigins.includes(value); }
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
      const fault = new Fault(terminal.get(result.error) ?? ({ missing_scope: 'missing_scopes', invalid_refresh_token: 'reauthorization_required', bad_client_secret: 'connector_misconfigured', invalid_client_id: 'connector_misconfigured', channel_not_found: 'not_found', message_not_found: 'not_found', thread_not_found: 'not_found', file_not_found: 'not_found', file_deleted: 'not_found', cant_update_message: 'forbidden', cant_delete_message: 'forbidden', not_in_channel: 'forbidden', is_archived: 'forbidden', msg_too_long: 'invalid_message' }[result.error]) ?? 'slack_request_failed', { not_found: 404, forbidden: 403, missing_scopes: 403 }[terminal.get(result.error) ?? ({ channel_not_found: 'not_found', message_not_found: 'not_found', thread_not_found: 'not_found', file_not_found: 'not_found', file_deleted: 'not_found', cant_update_message: 'forbidden', cant_delete_message: 'forbidden', not_in_channel: 'forbidden', is_archived: 'forbidden', missing_scope: 'missing_scopes' }[result.error])] ?? 400);
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
    return this.withGrant(credential, async grant => {
      const icon = grantedCapabilities(grant.scopes).teamIcon ? await this.teamIconUrl(grant).catch(() => null) : null;
      return normalizeWorkspace(grant, { hasIcon: Boolean(icon) });
    });
  }
  /** The team's uploaded icon from team.info, cached an hour; null when the
   * team still has Slack's generated default. */
  async teamIconUrl(grant) {
    const teamId = grant.identity.teamId;
    const cached = this.teamIcons.get(teamId);
    if (cached && cached.expiresAt > this.now()) return cached.url;
    const icon = (await this.call(grant, 'team.info', {})).team?.icon ?? {};
    const candidate = icon.image_132 ?? icon.image_88 ?? icon.image_68 ?? null;
    const url = !icon.image_default && typeof candidate === 'string' && candidate.startsWith(SLACK_AVATAR_HOST) ? candidate : null;
    this.teamIcons.set(teamId, { url, expiresAt: this.now() + 3_600_000 });
    return url;
  }
  async teamIcon(credential, teamId) {
    const url = await this.withGrant(credential, async grant => {
      if (teamId !== grant.identity.teamId) throw new Fault('not_found', 404);
      this.requireCapability(grant, 'teamIcon');
      const found = await this.teamIconUrl(grant);
      if (!found) throw new Fault('not_found', 404);
      return found;
    });
    const result = await this.download(url, null);
    if (!result.contentType.startsWith('image/')) throw new Fault('not_found', 404);
    return { ...result, name: 'team-icon' };
  }
  async conversations(credential) {
    return this.withGrant(credential, async (grant, grantId) => {
      this.requireCapability(grant, 'readConversations');
      const rows = await this.paged(grant, 'users.conversations', { types: 'public_channel,private_channel,mpim,im', exclude_archived: 'true', limit: '200' }, r => r.channels);
      // A group DM only names its members by handle ("mpdm-alice--bob--carol-1");
      // resolve handles to ids through the member list so clients can title it.
      let handles = null;
      if (rows.some(c => c.is_mpim)) {
        const members = await this.paged(grant, 'users.list', { limit: '200' }, r => r.members);
        handles = new Map(members.map(m => [m.name, m.id]));
      }
      const channels = rows.map(c => ({ ...normalizeChannel(c, { teamId: grant.identity.teamId, selfUserId: grant.identity.userId, handles }), lastActivityAt: this.activityAt(grantId, String(c.id)) }));
      const order = { standard: 0, group_dm: 1, dm: 2 };
      this.activityTargets.set(grantId, { channels: [...channels].sort((a, b) => order[a.kind] - order[b.kind]).map(c => c.id), seenAt: this.now() });
      return channels;
    });
  }
  async members(credential) {
    return this.withGrant(credential, async grant => {
      this.requireCapability(grant, 'readConversations');
      const rows = await this.paged(grant, 'users.list', { limit: '200' }, r => r.members);
      const people = rows.map(normalizeMember).filter(m => !m.deleted).map(({ deleted, ...m }) => m);
      return [...people, ...(this.bots.get(grant.identity.teamId)?.values() ?? [])];
    });
  }
  static cursorOk(cursor) { return cursor == null || cursor === '' || (typeof cursor === 'string' && /^[A-Za-z0-9=_-]{1,512}$/.test(cursor)); }
  async history(credential, { channel, cursor, limit }) {
    if (!idPattern.test(channel ?? '') || !Connector.cursorOk(cursor)) throw new Fault('invalid_request');
    const size = Math.min(200, Math.max(1, Number(limit) || 50));
    return this.withGrant(credential, async (grant, grantId) => {
      this.requireCapability(grant, 'readHistory');
      this.historyReadAt.set(grant.identity.teamId, this.now());
      const result = await this.call(grant, 'conversations.history', { channel, limit: String(size), ...(cursor ? { cursor } : {}) });
      const raw = (result.messages ?? []).filter(m => isTs(m.ts));
      this.rememberFiles(grantId, raw);
      this.rememberBots(grant.identity.teamId, raw);
      if (!cursor) this.recordActivity(grantId, channel, raw[0]?.ts ?? '');
      const messages = raw.map(m => normalizeMessage(m, { teamId: grant.identity.teamId, channelId: channel, readFiles: grantedCapabilities(grant.scopes).readFiles })).reverse();
      const next = result.response_metadata?.next_cursor || null;
      // Slack may cap the page below what was asked (15 for restricted apps);
      // a short page with more behind it is visibly partial, not complete.
      return { messages, cursor: result.has_more ? next : null, partial: Boolean(result.has_more) && messages.length < size };
    });
  }
  async replies(credential, { channel, ts, cursor }) {
    if (!idPattern.test(channel ?? '') || !isTs(ts) || !Connector.cursorOk(cursor)) throw new Fault('invalid_request');
    return this.withGrant(credential, async (grant, grantId) => {
      this.requireCapability(grant, 'readHistory');
      const result = await this.call(grant, 'conversations.replies', { channel, ts, limit: '200', ...(cursor ? { cursor } : {}) });
      const raw = (result.messages ?? []).filter(m => isTs(m.ts));
      this.rememberFiles(grantId, raw);
      this.rememberBots(grant.identity.teamId, raw);
      const all = raw.map(m => normalizeMessage(m, { teamId: grant.identity.teamId, channelId: channel, readFiles: grantedCapabilities(grant.scopes).readFiles }));
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
      return normalizeMessage({ ...result.message, ts: result.ts, channel: result.channel }, { teamId: grant.identity.teamId, channelId: result.channel ?? channel, readFiles: grantedCapabilities(grant.scopes).readFiles });
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
      this.rememberBots(grant.identity.teamId, matches);
      return { messages: matches.filter(m => isTs(m.ts) && m.channel?.id).map(m => normalizeMessage(m, { teamId: grant.identity.teamId, channelId: m.channel.id, readFiles: grantedCapabilities(grant.scopes).readFiles })), cursor: result.messages?.pagination?.next_cursor || null, partial: Boolean(result.messages?.pagination?.next_cursor) };
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
    // Re-check after waiting: a disconnect/removal must not resurrect a grant.
    return this.withGrantId(session.grantId, fn, () => this.session(credential));
  }
  /** The grant lock, token rotation and failure marking, by grant id — for
   * work no client request is waiting on (the activity check). */
  async withGrantId(grantId, fn, recheck = () => {}) {
    const session = { grantId };
    const original = this.store.get('grant', grantId);
    if (!original) throw new Fault('reauthorization_required', 401);
    return this.locked(identityKey(original.identity), async () => {
      recheck();
      let grant = this.store.get('grant', session.grantId);
      if (!grant) throw new Fault('reauthorization_required', 401);
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
  /** Sends are idempotent per grant + `client_msg_id` for ten minutes (#546):
   * a repeated send returns the first result, and a send whose outcome the
   * connector never learned (timeout, 5xx after the post) is reconciled
   * against Slack before anything is posted again. A retry is therefore safe
   * for the client to issue with the same id, and never through another
   * transport. Slack has no idempotency key of its own. */
  async send(credential, { channel, text, thread_ts: threadTs, client_msg_id: clientMsgId, file_ids: fileIds }) {
    if (Array.isArray(fileIds) && fileIds.length) return this.sendFiles(credential, { channel, text, threadTs, clientMsgId, fileIds });
    if (!idPattern.test(channel ?? '') || typeof text !== 'string' || !text.trim() || text.length > 4000 || (threadTs != null && !isTs(threadTs))) throw new Fault('invalid_message');
    if (clientMsgId != null && !/^[A-Za-z0-9_-]{8,128}$/.test(clientMsgId)) throw new Fault('invalid_message');
    return this.withGrant(credential, async (grant, grantId) => {
      if (!grantedCapabilities(grant.scopes).sendAsUser) throw new Fault('missing_scopes', 403);
      const key = clientMsgId ? hash(JSON.stringify([grantId, 'sent', clientMsgId])) : null;
      const prior = key ? this.store.get('sent', key) : null;
      if (prior?.status === 'done' && prior.expiresAt > this.now()) return prior.result;
      const budget = JSON.stringify([grant.identity.teamId, 'chat.postMessage']);
      if ((this.rateLimits.get(budget) ?? 0) > this.now()) throw new Fault('rate_limited', 429);
      const remember = value => { if (key) this.store.put('sent', key, { ...value, grantId, channel, expiresAt: this.now() + 600_000 }); };
      try {
        if (prior?.status === 'unknown') {
          const found = await this.reconcileSend(grant, { channel, text, threadTs, since: prior.startedAt });
          if (found) { remember({ status: 'done', result: found }); return found; }
        }
        remember({ status: 'unknown', startedAt: this.now() });
        // The body arrives as Flow markdown and goes out as mrkdwn; the reply
        // comes back through the same normalizer every read path uses.
        const result = await this.slack('chat.postMessage', { channel, text: markdownToMrkdwn(text), unfurl_links: 'false', unfurl_media: 'false', ...(threadTs ? { thread_ts: threadTs } : {}) }, grant.accessToken);
        // Slack stamps the app's bot_id/app_id/bot_profile on user-token posts
        // too, so authorship is message.user; a bot_message is never the user's.
        // 409, not 5xx: a proxy may replace a 5xx body and hide this code.
        if (result.message?.user !== grant.identity.userId || result.message?.subtype === 'bot_message') throw new Fault('authorship_mismatch', 409);
        const message = normalizeMessage({ ...result.message, ts: result.ts, channel: result.channel, ...(threadTs ? { thread_ts: threadTs } : {}) }, { teamId: grant.identity.teamId, channelId: result.channel ?? channel });
        const value = { channel: result.channel, ts: result.ts, userId: result.message.user, message };
        remember({ status: 'done', result: value });
        return value;
      } catch (error) {
        if (error.retryAfter) this.rateLimits.set(budget, this.now() + error.retryAfter * 1000);
        // Slack answered: the message was not posted, so the next attempt may post.
        if (error instanceof Fault && error.code !== 'slack_unavailable') { if (key) this.store.remove('sent', key); throw error; }
        // No answer, or a 5xx after Slack may have processed it: outcome unknown.
        // 504 tells the client to retry with the same id, which reconciles first.
        throw new Fault('send_unknown', 504);
      }
    });
  }
  /** Step one of a Slack upload: reserve an upload URL for the grant, send the
   * bytes there (outside the grant lock), and remember the pending file for
   * the channel. Nothing is visible in Slack until send() completes it. */
  async upload(credential, { channel, name, type, bytes }) {
    if (!idPattern.test(channel ?? '') || typeof name !== 'string' || !name.trim() || name.length > 255 || !Buffer.isBuffer(bytes) || !bytes.length) throw new Fault('invalid_request');
    if (bytes.length > MAX_FILE_BYTES) throw new Fault('file_too_large', 413);
    const { url, file } = await this.withGrant(credential, async (grant, grantId) => {
      this.requireCapability(grant, 'files');
      const reserved = await this.call(grant, 'files.getUploadURLExternal', { filename: name, length: String(bytes.length) });
      if (!fileIdPattern.test(reserved.file_id ?? '') || typeof reserved.upload_url !== 'string' || !reserved.upload_url.startsWith(SLACK_UPLOAD_HOST)) throw new Fault('slack_unavailable', 502);
      const mimeType = typeof type === 'string' && /^[\w.+-]+\/[\w.+-]+$/.test(type) ? type : 'application/octet-stream';
      const file = { id: reserved.file_id, workspaceId: grant.identity.teamId, userId: grant.identity.userId, name, mimeType, sizeBytes: bytes.length, width: null, height: null, hasThumb: false, createdAt: '' };
      this.store.put('upload', hash(JSON.stringify([grantId, reserved.file_id])), { grantId, channel, file, expiresAt: this.now() + 3_600_000 });
      return { url: reserved.upload_url, file };
    });
    let response;
    try {
      response = await this.fetcher(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(120_000), headers: { 'content-type': 'application/octet-stream' }, body: bytes });
    } catch { throw new Fault('slack_unavailable', 502); }
    if (!response.ok) throw new Fault('slack_unavailable', 502);
    return file;
  }
  /** Step two: share uploaded files into the channel as one message with the
   * text. Slack's complete call returns no ts and shares a moment later, so
   * the message is found through files.info; if it is not visible in time the
   * send is `send_unknown`, and a retry with the same client id only looks
   * again — it never completes the upload twice. */
  async sendFiles(credential, { channel, text = '', threadTs, clientMsgId, fileIds }) {
    if (!idPattern.test(channel ?? '') || typeof text !== 'string' || text.length > 4000 || (threadTs != null && !isTs(threadTs)) || fileIds.length > 10 || !fileIds.every(id => fileIdPattern.test(id))) throw new Fault('invalid_message');
    if (clientMsgId != null && !/^[A-Za-z0-9_-]{8,128}$/.test(clientMsgId)) throw new Fault('invalid_message');
    return this.withGrant(credential, async (grant, grantId) => {
      const granted = grantedCapabilities(grant.scopes);
      if (!granted.sendAsUser || !granted.files) throw new Fault('missing_scopes', 403);
      const key = clientMsgId ? hash(JSON.stringify([grantId, 'sent', clientMsgId])) : null;
      const prior = key ? this.store.get('sent', key) : null;
      if (prior?.status === 'done' && prior.expiresAt > this.now()) return prior.result;
      const remember = value => { if (key) this.store.put('sent', key, { ...value, grantId, channel, expiresAt: this.now() + 600_000 }); };
      if (!(prior?.status === 'unknown' && prior.completed)) {
        const pending = fileIds.map(id => this.store.get('upload', hash(JSON.stringify([grantId, id]))));
        if (pending.some(p => !p || p.channel !== channel || p.expiresAt <= this.now())) throw new Fault('invalid_message');
        const mrkdwn = text.trim() ? markdownToMrkdwn(text) : '';
        await this.call(grant, 'files.completeUploadExternal', { files: JSON.stringify(pending.map(p => ({ id: p.file.id, title: p.file.name }))), channel_id: channel, ...(threadTs ? { thread_ts: threadTs } : {}), ...(mrkdwn ? { initial_comment: mrkdwn } : {}) });
        for (const id of fileIds) this.store.remove('upload', hash(JSON.stringify([grantId, id])));
        remember({ status: 'unknown', completed: true, startedAt: this.now() });
      }
      const found = await this.findShare(grant, grantId, { channel, threadTs, fileIds, text });
      if (!found) throw new Fault('send_unknown', 504);
      remember({ status: 'done', result: found });
      return found;
    });
  }
  async findShare(grant, grantId, { channel, threadTs, fileIds, text }) {
    for (let attempt = 0; attempt < 6; attempt++) {
      if (attempt) await this.sleep(500);
      const infos = [];
      for (const id of fileIds) infos.push((await this.call(grant, 'files.info', { file: id })).file ?? {});
      const shares = [...(infos[0].shares?.public?.[channel] ?? []), ...(infos[0].shares?.private?.[channel] ?? [])];
      const share = shares.filter(s => isTs(s.ts) && (threadTs ? s.thread_ts === threadTs : true)).sort((a, b) => b.ts.localeCompare(a.ts))[0];
      if (!share) continue;
      const raw = { type: 'message', subtype: 'file_share', user: grant.identity.userId, ts: share.ts, text: text.trim() ? markdownToMrkdwn(text) : '', files: infos, ...(threadTs ? { thread_ts: threadTs } : {}) };
      this.rememberFiles(grantId, [raw]);
      const message = normalizeMessage(raw, { teamId: grant.identity.teamId, channelId: channel, readFiles: grantedCapabilities(grant.scopes).readFiles });
      return { channel, ts: share.ts, userId: grant.identity.userId, message };
    }
    return null;
  }
  /** After an unknown outcome: does Slack already hold this message? One
   * history/replies call (the rare path pays one budget unit), matched on
   * author, exact outgoing text and a timestamp not older than the attempt. */
  async reconcileSend(grant, { channel, text, threadTs, since }) {
    const wanted = markdownToMrkdwn(text);
    const result = threadTs
      ? await this.call(grant, 'conversations.replies', { channel, ts: threadTs, limit: '50' })
      : await this.call(grant, 'conversations.history', { channel, limit: '20' });
    const floor = Math.floor(since / 1000) - 5;
    const match = (result.messages ?? []).find(m => isTs(m.ts) && m.user === grant.identity.userId && m.text === wanted && Number(m.ts.split('.')[0]) >= floor && (threadTs ? m.thread_ts === threadTs : !m.thread_ts || m.thread_ts === m.ts));
    if (!match) return null;
    const message = normalizeMessage({ ...match, channel }, { teamId: grant.identity.teamId, channelId: channel });
    return { channel, ts: match.ts, userId: match.user, message, reconciled: true };
  }
  /** Set (or clear, with both empty) the user's own Slack status. Flow's picker
   * sends unicode; Slack wants a shortcode, so an emoji Slack has no name for
   * in the shared table is refused rather than sent as text. Returns the user
   * in the shape Flow's PATCH /v1/me returns. */
  async setStatus(credential, { statusEmoji = '', statusText = '' }) {
    if (typeof statusEmoji !== 'string' || typeof statusText !== 'string' || statusText.length > 100 || statusEmoji.length > 102) throw new Fault('invalid_request');
    const name = !statusEmoji ? '' : /^:[a-z0-9_+'.-]{1,100}:$/.test(statusEmoji) ? statusEmoji : emojiNameFor(statusEmoji);
    if (name === null) throw new Fault('unsupported_emoji');
    return this.withGrant(credential, async grant => {
      this.requireCapability(grant, 'setStatus');
      const result = await this.call(grant, 'users.profile.set', { profile: JSON.stringify({ status_text: statusText, status_emoji: name, status_expiration: 0 }) });
      const member = normalizeMember({ id: grant.identity.userId, name: grant.userName, profile: result.profile ?? {} });
      return {
        id: member.userId, email: member.email, displayName: member.displayName, avatarUrl: member.avatarUrl, timezone: 'UTC',
        statusEmoji: member.statusEmoji, statusText: member.statusText, website: '', bio: '', title: member.title, isAgent: false,
        sponsorId: null, notificationPrefs: {}, statusSuppressAlerts: false, privacyMode: false, createdAt: '',
      };
    });
  }
  // ---- conversation activity ------------------------------------------------
  // Slack's sidebar hides conversations with no new message in 30 days, and
  // the public API does not expose a channel's latest message to this app. The
  // connector learns it from what it already sees (live message events, the
  // latest history page someone loads) and a slow background check.
  activityAt(grantId, channelId) {
    const row = this.store.get('activity', hash(JSON.stringify([grantId, channelId])));
    return row?.latestTs ? tsToIso(row.latestTs) : null;
  }
  /** `latestTs` '' records "checked, no messages". Never moves backwards. */
  recordActivity(grantId, channelId, latestTs) {
    const id = hash(JSON.stringify([grantId, channelId]));
    const prior = this.store.get('activity', id);
    const newest = prior?.latestTs && (!latestTs || prior.latestTs.localeCompare(latestTs) > 0) ? prior.latestTs : latestTs;
    this.store.put('activity', id, { latestTs: newest, checkedAt: this.now(), expiresAt: this.now() + 90 * 86400_000 });
    if (newest && newest !== prior?.latestTs) this.appendStream(grantId, { type: 'channel.activity', channelId, lastActivityAt: tsToIso(newest) });
  }
  /** Note the apps behind bot messages; a new or renamed one reaches every
   * grant on the team as member.updated, so the sender stops reading Unknown. */
  rememberBots(teamId, messages) {
    let known = this.bots.get(teamId);
    for (const message of messages) {
      const member = botMember(message);
      if (!member) continue;
      if (!known) { known = new Map(); this.bots.set(teamId, known); }
      const prior = known.get(member.userId);
      if (prior && prior.displayName === member.displayName && prior.avatarUrl === member.avatarUrl) continue;
      known.set(member.userId, member);
      for (const { id, value: grant } of this.store.all('grant')) {
        if (grant.identity.teamId === teamId && grant.status === 'active') this.appendStream(id, { type: 'member.updated', member });
      }
    }
  }
  appendStream(grantId, event) {
    const grant = this.store.get('grant', grantId);
    if (!grant) return;
    this.streamSeq = (this.streamSeq ?? 0) + 1;
    this.store.put('stream', opaque(), { grantId, generation: grant.generation, seq: this.streamSeq, event, expiresAt: this.now() + 300_000 });
  }
  /** One background check per tick: the newest message of one conversation a
   * recently seen grant has never had checked (or not in a week). Skipped
   * while someone on the team loaded history in the last two minutes, and
   * while Slack has the history budget parked. Returns what it checked. */
  async activityTick() {
    const now = this.now();
    for (const [grantId, target] of this.activityTargets) {
      if (now - target.seenAt > 86400_000) { this.activityTargets.delete(grantId); continue; }
      const grant = this.store.get('grant', grantId);
      if (!grant || grant.status !== 'active' || !grantedCapabilities(grant.scopes).readHistory) continue;
      const team = grant.identity.teamId;
      if (now - (this.historyReadAt.get(team) ?? 0) < 120_000) continue;
      if ((this.rateLimits.get(this.budgetKey(grant, 'conversations.history')) ?? 0) > now) continue;
      const channelId = target.channels.find(id => {
        const row = this.store.get('activity', hash(JSON.stringify([grantId, id])));
        return !row || now - row.checkedAt > 7 * 86400_000;
      });
      if (!channelId) continue;
      try {
        await this.withGrantId(grantId, async current => {
          const result = await this.call(current, 'conversations.history', { channel: channelId, limit: '1' });
          this.recordActivity(grantId, channelId, (result.messages ?? []).find(m => isTs(m.ts))?.ts ?? '');
        });
      } catch (error) {
        // Parked budget or a channel that went away: try it again next week, not next tick.
        if (!error.retryAfter) this.recordActivity(grantId, channelId, '');
      }
      return { grantId, channelId };
    }
    return null;
  }
  // ---- file bytes and custom emoji ---------------------------------------------
  rememberFiles(grantId, messages) {
    for (const message of messages) {
      for (const file of message.files ?? []) {
        if (!fileIdPattern.test(file.id ?? '')) continue;
        const key = JSON.stringify([grantId, file.id]);
        this.fileRefs.delete(key);
        this.fileRefs.set(key, file);
      }
    }
    for (const key of this.fileRefs.keys()) { if (this.fileRefs.size <= 5000) break; this.fileRefs.delete(key); }
  }
  /** One Slack file's bytes, fetched with the user token. Only the URL lookup
   * runs under the grant lock; the download does not, so a channel full of
   * previews loads in parallel. `variant` is 'thumb' or 'original'. */
  async file(credential, { id, variant }) {
    if (!fileIdPattern.test(id ?? '')) throw new Fault('invalid_request');
    const { url, token, name } = await this.withGrant(credential, async (grant, grantId) => {
      this.requireCapability(grant, 'readFiles');
      let file = this.fileRefs.get(JSON.stringify([grantId, id]));
      if (!file) {
        file = (await this.call(grant, 'files.info', { file: id })).file ?? {};
        this.rememberFiles(grantId, [{ files: [{ ...file, id }] }]);
      }
      const url = variant === 'thumb' ? slackThumbUrl(file) : file.url_private;
      if (typeof url !== 'string' || !url.startsWith(SLACK_FILE_HOST)) throw new Fault('not_found', 404);
      return { url, token: grant.accessToken, name: String(file.name ?? 'file') };
    });
    return { ...(await this.download(url, token)), name };
  }
  async download(url, token) {
    let response;
    try {
      response = await this.fetcher(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(30_000), headers: token ? { authorization: `Bearer ${token}` } : {} });
    } catch { throw new Fault('slack_unavailable', 502); }
    if (response.status === 404) throw new Fault('not_found', 404);
    if (!response.ok) throw new Fault('slack_unavailable', 502);
    // Slack answers a token it will not honor with its HTML sign-in page.
    const contentType = String(response.headers.get('content-type') ?? 'application/octet-stream').split(';')[0].trim().toLowerCase();
    if (contentType === 'text/html') throw new Fault('forbidden', 403);
    const length = Number(response.headers.get('content-length'));
    if (length > MAX_FILE_BYTES) throw new Fault('file_too_large', 413);
    return { contentType, length: Number.isFinite(length) && length > 0 ? length : null, body: response.body };
  }
  /** Custom emoji for the grant's team, aliases resolved, cached ten minutes. */
  async emojiNames(grant) {
    const teamId = grant.identity.teamId;
    const cached = this.emojiCache.get(teamId);
    if (cached && cached.expiresAt > this.now()) return cached.names;
    const listed = (await this.call(grant, 'emoji.list', {})).emoji ?? {};
    const names = new Map();
    for (const [name, value] of Object.entries(listed)) {
      let target = value;
      for (let hops = 0; typeof target === 'string' && target.startsWith('alias:') && hops < 3; hops++) target = listed[target.slice(6)];
      if (emojiNamePattern.test(name) && typeof target === 'string' && target.startsWith(SLACK_EMOJI_HOST)) names.set(name, target);
    }
    this.emojiCache.set(teamId, { names, expiresAt: this.now() + 600_000 });
    return names;
  }
  /** The shape Flow's /v1/workspaces/:id/emoji returns; each image is served
   * at /v1/files/emoji:<name>, so clients reuse their Flow emoji rendering. */
  async emoji(credential, workspaceId) {
    return this.withGrant(credential, async grant => {
      if (workspaceId !== grant.identity.teamId) throw new Fault('not_found', 404);
      this.requireCapability(grant, 'customEmoji');
      const names = await this.emojiNames(grant);
      return [...names.keys()].sort().map(name => ({ id: `emoji:${name}`, workspaceId: grant.identity.teamId, shortcode: name, emoji: `:${name}:`, fileId: `emoji:${name}`, createdBy: '', createdAt: '' }));
    });
  }
  async emojiImage(credential, name) {
    if (!emojiNamePattern.test(name ?? '')) throw new Fault('invalid_request');
    const url = await this.withGrant(credential, async grant => {
      this.requireCapability(grant, 'customEmoji');
      const found = (await this.emojiNames(grant)).get(name);
      if (!found) throw new Fault('not_found', 404);
      return found;
    });
    const result = await this.download(url, null);
    if (!result.contentType.startsWith('image/')) throw new Fault('not_found', 404);
    return { ...result, name };
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
    // Protocol drift is isolated to the one event: a payload the normalizer
    // cannot read is acknowledged and dropped (Slack would otherwise retry it
    // three times), and the next well-formed event still flows (#546).
    // Normalized twice at most: file previews depend on the grant's files:read.
    let normalized, previewable;
    try {
      normalized = normalizeEvent(envelope.event, { teamId: envelope.team_id });
      previewable = normalizeEvent(envelope.event, { teamId: envelope.team_id, readFiles: true });
    } catch { this.driftCount = (this.driftCount ?? 0) + 1; return { ok: true }; }
    if (!normalized) return { ok: true };
    const source = envelope.event?.subtype === 'message_changed' ? envelope.event.message : envelope.event;
    // A profile is visible to everyone on the team, and Slack names only one
    // authorization per event, so a member update goes to every grant there.
    const teamWide = normalized.type === 'member.updated';
    const authorized = new Set((envelope.authorizations ?? []).filter(a => !a.is_bot && typeof a.user_id === 'string').map(a => a.user_id));
    if (!authorized.size && !teamWide) return { ok: true };
    this.sweep();
    this.store.transaction(() => {
      for (const { id, value: grant } of this.store.all('grant')) {
        if (grant.appId !== envelope.api_app_id || grant.identity.teamId !== envelope.team_id || grant.status !== 'active' || !(teamWide ? grantedCapabilities(grant.scopes).memberUpdates : authorized.has(grant.identity.userId))) continue;
        const rowId = hash(JSON.stringify([envelope.event_id, id, 'stream']));
        if (this.store.get('stream', rowId)) continue;
        this.streamSeq = (this.streamSeq ?? 0) + 1;
        const readFiles = grantedCapabilities(grant.scopes).readFiles;
        if (readFiles && source?.files) this.rememberFiles(id, [source]);
        if (source) this.rememberBots(grant.identity.teamId, [source]);
        this.store.put('stream', rowId, { grantId: id, generation: grant.generation, seq: this.streamSeq, event: readFiles ? previewable : normalized, expiresAt: this.now() + 300_000 });
      }
      // A new message is activity for every grant that lists the channel, not
      // only the one Slack named in `authorizations`.
      if (normalized.type === 'message.created') {
        const channelId = normalized.message.channelId;
        for (const [grantId, target] of this.activityTargets) {
          if (target.channels.includes(channelId) || authorized.has(this.store.get('grant', grantId)?.identity.userId)) this.recordActivity(grantId, channelId, normalized.message.id);
        }
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

let emojiNames = null;
/** Unicode emoji -> Slack shortcode (with colons), or null when unknown. */
export function emojiNameFor(emoji) {
  // Keyed without variation selectors: 🗓 and 🗓️ are the same emoji.
  const bare = value => value.replace(/\uFE0F/g, '');
  // The shared table last, so its names win (they are what Flow's picker uses).
  if (!emojiNames) emojiNames = new Map([...Object.entries(SLACK_EMOJI), ...Object.entries(EMOJI_SHORTCODES)].map(([name, unicode]) => [bare(unicode), name]));
  const name = emojiNames.get(bare(emoji));
  return name ? `:${name}:` : null;
}
