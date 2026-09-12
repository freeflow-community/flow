// SlackBackend — the WorkspaceBackend a connected Slack team speaks, over the
// Flow Slack connector's public-API baseline (#545; docs/specs, "Public API
// baseline and feature mapping"; measured limits in
// docs/design/slack-protocol/README.md §6).
//
// The connector already normalizes Slack payloads into the shared DTO shapes,
// so this class is about three things: capability states with honest reasons,
// the rate budget surfaced as `limited` history rather than a spinner, and a
// polled event stream that reconciles by `ts`. Nothing here builds a Slack URL
// other than the Open in Slack deep link.
import {
  BackendError, EMOJI_SHORTCODES, capabilitiesFrom, limited, supported, unavailable,
  type BackendAuthState, type BackendChannel, type BackendEvent, type BackendEventHandler, type BackendMessage,
  type Capabilities, type FileDTO, type HistoryPage, type SearchResult, type SendMessageInput, type SendReceipt,
  type ThreadPage, type UserDTO, type WorkspaceBackend, type WorkspaceDTO, type WorkspaceMemberDTO,
} from '@flow/shared';
import type { ConnectionRuntime } from '../connectionRuntime';
import { slackStatusMessage, type SlackConnection } from '../slackConnector';

/** Connector capability flags (manifest.js grantedCapabilities) -> the UI's
 * tri-state per control. Exported so the switcher can preview a grant. */
export function slackCapabilities(granted: Record<string, boolean>): Capabilities {
  const flow = unavailable('Not available in Slack workspaces. Open in Slack for this.');
  const scope = (name: string) => unavailable(`This Slack app has not been granted ${name} permissions.`);
  return capabilitiesFrom(flow, {
    conversations: granted.readConversations ? supported() : scope('conversation'),
    history: granted.readHistory ? limited('Slack allows this app one history page per minute, 15 messages at a time. Older messages load slowly.') : scope('history'),
    threads: granted.readHistory ? limited('Thread replies load under the same Slack history limit.') : scope('history'),
    send: granted.sendAsUser ? supported() : scope('send'),
    edit: granted.sendAsUser ? supported() : scope('send'),
    delete: granted.sendAsUser ? supported() : scope('send'),
    reactions: granted.reactions ? supported() : scope('reaction'),
    files: granted.files ? limited('Files upload to Slack; previews open in Slack.') : unavailable('File uploads need a Slack permission this app does not have. Attachments open in Slack.'),
    search: granted.search ? supported() : scope('search'),
    readState: granted.readState ? supported() : unavailable('Read markers are not shared with Slack; unread state stays on this device.'),
    liveUpdates: granted.liveUpdates ? limited('New messages arrive through the Flow Slack connector with a short delay.') : unavailable('Live updates need the Slack app to subscribe to message events.'),
    typing: unavailable('Typing indicators are not available for Slack workspaces.'),
    presence: unavailable('Presence is not available for Slack workspaces.'),
    notifications: unavailable('Slack notifications are not delivered to Flow yet.'),
  });
}

interface StreamResponse { events: BackendEvent[]; seq: number; gap: boolean }

const STREAM_INTERVAL_MS = 3000;
const LIFECYCLE_INTERVAL_MS = 15_000;

export class SlackBackend implements WorkspaceBackend {
  readonly provider = 'slack' as const;
  readonly connectionId: string;
  private caps: Capabilities;
  private authState: BackendAuthState;
  private teamId: string;
  private handlers = new Set<BackendEventHandler>();
  private poller: ReturnType<typeof setInterval> | null = null;
  /** False in tests, which call `pollOnce()` themselves. */
  private readonly autoPoll: boolean;
  private seq = 0;
  private members: Map<string, WorkspaceMemberDTO> | null = null;

  constructor(private readonly runtime: ConnectionRuntime, connection: { providerIdentity: string; capabilities: Record<string, boolean>; label: string }, options: { autoPoll?: boolean } = {}) {
    this.connectionId = runtime.connectionId;
    this.autoPoll = options.autoPoll ?? true;
    this.caps = slackCapabilities(connection.capabilities);
    let teamId = '';
    try { teamId = (JSON.parse(connection.providerIdentity) as string[])[2] ?? ''; } catch { /* label only */ }
    this.teamId = teamId;
    this.authState = { status: runtime.getToken() ? 'authenticated' : 'signed_out', userId: runtime.userId, label: connection.label };
  }

  // ---- transport ------------------------------------------------------------

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const credential = this.runtime.getToken();
    if (!credential) throw new BackendError('unauthorized', slackStatusMessage('reauthorization_required'));
    if (this.runtime.isDisposed) throw new BackendError('timeout', 'connection closed');
    let response: Response;
    try {
      response = await fetch(`${this.runtime.origin}${path}`, {
        method, credentials: 'omit', redirect: 'error',
        headers: { ...(body ? { 'content-type': 'application/json' } : {}), authorization: `Bearer ${credential}` },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch (error) {
      throw new BackendError('timeout', error instanceof Error ? error.message : 'Slack connector unreachable');
    }
    const result = (await response.json().catch(() => ({}))) as { error?: string } & T;
    if (response.ok) return result;
    const code = typeof result.error === 'string' ? result.error : `http_${response.status}`;
    if (response.status === 429) {
      const seconds = Number(response.headers.get('retry-after')) || 60;
      throw new BackendError('rate_limited', `Slack asked Flow to wait ${seconds} seconds before loading more.`, { retryAfterMs: seconds * 1000, providerCode: code });
    }
    if (response.status === 401) {
      this.setAuth({ ...this.authState, status: 'reauthorization_required', detail: slackStatusMessage(code) });
      throw new BackendError('unauthorized', slackStatusMessage(code), { providerCode: code });
    }
    if (code === 'missing_scopes') throw new BackendError('unsupported', 'This Slack app has not been granted the permission for that.', { providerCode: code });
    // The connector could not learn whether Slack took the message: the row
    // stays failed with Retry, and the retry carries the same client id.
    if (response.status === 504 || code === 'send_unknown') throw new BackendError('timeout', 'Slack did not confirm the message. Retry sends it once, never twice.', { providerCode: code });
    if (response.status === 404) throw new BackendError('not_found', slackStatusMessage(code), { providerCode: code });
    if (response.status === 403) throw new BackendError('invalid', 'Slack did not allow that action.', { providerCode: code });
    throw new BackendError(response.status >= 500 ? 'provider_error' : 'invalid', slackStatusMessage(code), { providerCode: code });
  }

  private emit(event: BackendEvent): void { for (const handler of this.handlers) handler(event); }

  private setAuth(next: BackendAuthState): void {
    if (next.status === this.authState.status && next.detail === this.authState.detail) return;
    this.authState = next;
    this.emit({ type: 'auth.changed', auth: next });
  }

  private setCapabilities(granted: Record<string, boolean>): void {
    const next = slackCapabilities(granted);
    if (JSON.stringify(next) === JSON.stringify(this.caps)) return;
    this.caps = next;
    this.emit({ type: 'capabilities.changed', capabilities: next });
  }

  // ---- contract ---------------------------------------------------------------

  auth(): BackendAuthState { return this.authState; }
  capabilities(): Capabilities { return this.caps; }

  async me(): Promise<UserDTO> {
    const info = await this.request<SlackConnection>('GET', '/v1/connection');
    this.setCapabilities(info.capabilities);
    if (info.grantStatus !== 'active') this.setAuth({ ...this.authState, status: 'reauthorization_required', detail: slackStatusMessage(info.grantStatus) });
    else this.setAuth({ status: 'authenticated', userId: info.identity.userId, label: `${info.teamName} · ${info.userName}` });
    const member = await this.memberById(info.identity.userId);
    return {
      id: info.identity.userId, email: member?.email ?? '', displayName: member?.displayName ?? info.userName, avatarUrl: member?.avatarUrl ?? null,
      timezone: 'UTC', statusEmoji: member?.statusEmoji ?? '', statusText: member?.statusText ?? '', website: '', bio: '', title: member?.title ?? '',
      isAgent: false, sponsorId: null, notificationPrefs: {}, statusSuppressAlerts: false, privacyMode: false, createdAt: '',
    };
  }

  private async memberById(userId: string): Promise<WorkspaceMemberDTO | undefined> {
    try {
      if (!this.members) await this.listMembers();
      return this.members?.get(userId);
    } catch { return undefined; }
  }

  async signOut(): Promise<void> {
    await this.request('DELETE', '/v1/session').catch(() => {});
    this.setAuth({ ...this.authState, status: 'signed_out' });
  }

  async listWorkspaces(): Promise<WorkspaceDTO[]> {
    return [await this.request<WorkspaceDTO>('GET', '/v1/workspace')];
  }

  async listConversations(): Promise<BackendChannel[]> {
    return (await this.request<{ conversations: BackendChannel[] }>('GET', '/v1/conversations')).conversations;
  }

  async listMembers(): Promise<WorkspaceMemberDTO[]> {
    const members = (await this.request<{ members: WorkspaceMemberDTO[] }>('GET', '/v1/members')).members;
    this.members = new Map(members.map(m => [m.userId, m]));
    return members;
  }

  /** One page per minute, 15 messages each, for this app (measured). The page
   * comes back `partial` whenever Slack held more behind it, and a 429 is a
   * `rate_limited` error the hook turns into a wait, never a retry loop. */
  history(channelId: string, { cursor, limit }: { cursor: string | null; limit: number }): Promise<HistoryPage> {
    const size = Math.min(limit, 15);
    return this.request<HistoryPage>('GET', `/v1/history?channel=${encodeURIComponent(channelId)}&limit=${size}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
  }

  thread(channelId: string, rootId: string, options: { cursor: string | null } = { cursor: null }): Promise<ThreadPage> {
    return this.request<ThreadPage>('GET', `/v1/replies?channel=${encodeURIComponent(channelId)}&ts=${encodeURIComponent(rootId)}${options.cursor ? `&cursor=${encodeURIComponent(options.cursor)}` : ''}`);
  }

  async send(input: SendMessageInput): Promise<SendReceipt> {
    if (input.fileIds?.length) throw new BackendError('unsupported', this.caps.files.reason ?? 'Files are not available.');
    // The client id makes the send idempotent at the connector: a retry after
    // a timeout reconciles against Slack instead of posting twice (#546).
    const result = await this.request<{ message: BackendMessage }>('POST', '/v1/messages', {
      channel: input.channelId, text: input.body, client_msg_id: input.clientMsgId, ...(input.threadRootId ? { thread_ts: input.threadRootId } : {}),
    });
    // Slack does not echo a client message id; the connector's reply carries
    // the real ts, so stamp our idempotency key on it for the optimistic row.
    return { message: { ...result.message, clientMsgId: input.clientMsgId } };
  }

  edit(channelId: string, messageId: string, body: string): Promise<BackendMessage> {
    return this.request<BackendMessage>('PATCH', '/v1/messages', { channel: channelId, ts: messageId, text: body });
  }

  async delete(channelId: string, messageId: string): Promise<void> {
    await this.request('DELETE', '/v1/messages', { channel: channelId, ts: messageId });
  }

  async setReaction(channelId: string, messageId: string, emoji: string, on: boolean): Promise<void> {
    const name = shortcodeFor(emoji);
    if (!name) throw new BackendError('unsupported', 'Slack does not know this emoji.');
    await this.request('POST', '/v1/reactions', { channel: channelId, ts: messageId, name, on });
  }

  async markRead(channelId: string, messageId: string): Promise<void> {
    if (this.caps.readState.state === 'unavailable') return; // local-only read state; never a Flow mutation
    await this.request('POST', '/v1/read', { channel: channelId, ts: messageId });
  }

  uploadFile(): Promise<FileDTO> {
    return Promise.reject(new BackendError('unsupported', this.caps.files.reason ?? 'File uploads are not available.'));
  }

  /** No file bytes flow through Flow: previews and downloads open in Slack. */
  fileUrl(): string | null { return null; }

  search(query: string, options: { cursor: string | null } = { cursor: null }): Promise<SearchResult> {
    return this.request<SearchResult>('GET', `/v1/search?q=${encodeURIComponent(query)}${options.cursor ? `&cursor=${encodeURIComponent(options.cursor)}` : ''}`);
  }

  /** Chat events polled from the connector's per-grant stream. A gap in the
   * stream (we fell behind its retention) is reported as `stream.degraded`
   * followed by `stream.recovered`, which the caller treats as "refetch". */
  subscribe(handler: BackendEventHandler): () => void {
    this.handlers.add(handler);
    if (this.poller === null && this.autoPoll) this.startPolling();
    return () => {
      this.handlers.delete(handler);
      if (this.handlers.size === 0 && this.poller !== null) { clearInterval(this.poller); this.poller = null; }
    };
  }

  /** Events the stream delivered in a shape this client could not read;
   * dropped one by one so a schema change never takes the stream down (#546). */
  dropped = 0;
  private ticks = 0;

  /** One poll of the connector stream; the interval calls this, and tests do. */
  async pollOnce(): Promise<void> {
    if (this.runtime.isDisposed || !this.runtime.getToken()) return;
    try {
      const stream = await this.request<StreamResponse>('GET', `/v1/stream?since=${this.seq}`);
      if (stream.gap) { this.emit({ type: 'stream.degraded', reason: 'Missed Slack events while away.', resumesAtMs: null }); this.emit({ type: 'stream.recovered' }); }
      for (const event of stream.events ?? []) {
        if (isWellFormed(event)) this.emit(event);
        else this.dropped += 1;
      }
      if (typeof stream.seq === 'number') this.seq = stream.seq;
    } catch (error) {
      if (error instanceof BackendError && error.code === 'rate_limited') this.emit({ type: 'stream.degraded', reason: error.message, resumesAtMs: Date.now() + (error.retryAfterMs ?? 60_000) });
    }
    if (this.ticks++ % Math.round(LIFECYCLE_INTERVAL_MS / STREAM_INTERVAL_MS) === 0) {
      try {
        const lifecycle = await this.request<{ events: { status: string }[] }>('GET', '/v1/events');
        const last = lifecycle.events.at(-1)?.status;
        if (last && last !== 'active') this.setAuth({ ...this.authState, status: 'reauthorization_required', detail: slackStatusMessage(last) });
      } catch { /* reported on the next request that needs the grant */ }
    }
  }

  private startPolling(): void {
    void this.pollOnce();
    this.poller = setInterval(() => { void this.pollOnce(); }, STREAM_INTERVAL_MS);
  }

  openUrl(target: { channelId: string; messageId?: string }): string | null {
    if (!this.teamId) return null;
    const base = `https://app.slack.com/client/${this.teamId}/${target.channelId}`;
    return target.messageId ? `${base}/p${target.messageId.replace('.', '')}` : base;
  }
}

const TS_RE = /^\d{9,11}\.\d{6}$/;
const isMessageShape = (m: unknown): m is BackendMessage => {
  const x = m as Record<string, unknown> | null;
  return !!x && typeof x.id === 'string' && TS_RE.test(x.id) && typeof x.channelId === 'string' && typeof x.userId === 'string' && typeof x.body === 'string'
    && Array.isArray(x.files) && Array.isArray(x.reactions) && Array.isArray(x.replyParticipantUserIds) && (x.threadRootId === null || typeof x.threadRootId === 'string');
};

/** Validate one stream event before it reaches the cache: known type, and the
 * fields the views will read. Anything else is protocol drift, dropped here. */
export function isWellFormed(event: unknown): event is BackendEvent {
  const e = event as Record<string, unknown> | null;
  if (!e || typeof e.type !== 'string') return false;
  switch (e.type) {
    case 'message.created': case 'message.updated': case 'thread.reply': return isMessageShape(e.message);
    case 'message.deleted': return typeof e.channelId === 'string' && typeof e.messageId === 'string' && (e.threadRootId === null || typeof e.threadRootId === 'string');
    case 'reaction.added': case 'reaction.removed': return typeof e.channelId === 'string' && typeof e.messageId === 'string' && typeof e.emoji === 'string' && typeof e.userId === 'string';
    case 'channel.updated': return !!e.channel && typeof (e.channel as { id?: unknown }).id === 'string';
    case 'channel.read': case 'typing': case 'presence': case 'auth.changed': case 'capabilities.changed': case 'stream.degraded': case 'stream.recovered': return true;
    default: return false;
  }
}

let shortcodes: Map<string, string> | null = null;
/** Unicode emoji -> Slack reaction name, from the shared shortcode table. */
export function shortcodeFor(emoji: string): string | null {
  if (!shortcodes) shortcodes = new Map(Object.entries(EMOJI_SHORTCODES).map(([name, unicode]) => [unicode, name]));
  if (/^:[a-z0-9_+-]+:$/.test(emoji)) return emoji.slice(1, -1);
  return shortcodes.get(emoji) ?? null;
}
