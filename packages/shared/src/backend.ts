// WorkspaceBackend — the provider contract every Flow client consumes
// (docs/specs/multi-server-workspaces.md, "Provider abstraction and identity",
// "Public API baseline and feature mapping", "Notifications and parity").
//
// One connection = one backend. FlowBackend speaks Flow REST/WS; SlackBackend
// speaks the Slack connector's public-API baseline (and, later, verified
// internal-protocol capabilities behind the same interface). UI code consumes
// this interface and the normalized DTOs; it never builds a provider path, and
// an action whose capability is not `supported` never falls through to a Flow
// server mutation.
//
// Identity rules (spec lines 247-261) are enforced by the helpers at the bottom:
// provider-native ids stay strings; a Slack message is keyed by the exact `ts`
// string and never converted through a number or given a manufactured UUID.
import type { ChannelDTO, FileDTO, MessageDTO, MessagePage, UserDTO, WorkspaceDTO, WorkspaceMemberDTO } from './dto.js';

export type BackendProvider = 'flow' | 'slack';

// ---- capabilities -----------------------------------------------------------

export type CapabilityState = 'supported' | 'limited' | 'unavailable';

/** A control's state plus the sentence the client shows for it. `reason` is
 * required unless the capability is fully supported. */
export interface Capability {
  state: CapabilityState;
  reason?: string;
}

export const CAPABILITY_NAMES = [
  'conversations', 'history', 'threads', 'send', 'edit', 'delete', 'reactions', 'files', 'search',
  'readState', 'liveUpdates', 'typing', 'presence', 'pins', 'huddles', 'artifacts', 'agents', 'apps',
  'admin', 'scheduledMessages', 'notifications', 'channelManagement',
] as const;
export type CapabilityName = (typeof CAPABILITY_NAMES)[number];
export type Capabilities = Record<CapabilityName, Capability>;

export const supported = (): Capability => ({ state: 'supported' });
export const limited = (reason: string): Capability => ({ state: 'limited', reason });
export const unavailable = (reason: string): Capability => ({ state: 'unavailable', reason });

/** Every capability supported — the Flow backend's baseline. */
export function allSupported(): Capabilities {
  return Object.fromEntries(CAPABILITY_NAMES.map(name => [name, supported()])) as Capabilities;
}

/** Every capability unavailable with one reason, then overridden per name. */
export function capabilitiesFrom(base: Capability, overrides: Partial<Capabilities>): Capabilities {
  const all = Object.fromEntries(CAPABILITY_NAMES.map(name => [name, base])) as Capabilities;
  return { ...all, ...overrides };
}

export function canUse(caps: Capabilities, name: CapabilityName): boolean {
  return caps[name].state !== 'unavailable';
}

// ---- auth -------------------------------------------------------------------

export type BackendAuthStatus = 'authenticated' | 'unauthorized' | 'reauthorization_required' | 'signed_out';

export interface BackendAuthState {
  status: BackendAuthStatus;
  /** Provider-native user id of the signed-in identity ("U…" for Slack). */
  userId: string | null;
  /** Human-readable identity line for the switcher ("alice · Acme"). */
  label: string;
  /** For providers with an installation/grant lifecycle: the reason a
   * non-authenticated status was reached, in the provider's own words. */
  detail?: string;
}

// ---- normalized models ------------------------------------------------------

/** Where a message came from and how to open it natively. Present only on
 * messages from a non-Flow provider. */
export interface MessageProvenance {
  provider: Exclude<BackendProvider, 'flow'>;
  /** Deep link into the provider's own client ("Open in Slack"). */
  openUrl: string | null;
  /** True when the message carried content the client could not render
   * faithfully (unknown blocks, unsupported attachments): the body is a safe
   * textual fallback and the UI offers `openUrl`. */
  degraded: boolean;
  /** Provider message subtype, preserved verbatim for later phases. */
  subtype?: string | null;
}

export type BackendMessage = MessageDTO & { provenance?: MessageProvenance };
export type BackendChannel = ChannelDTO & { provenance?: Pick<MessageProvenance, 'provider' | 'openUrl'> };

export interface HistoryPage {
  /** Oldest first, like the transcript. */
  messages: BackendMessage[];
  /** Opaque provider cursor for the next older page; null when exhausted. */
  cursor: string | null;
  /** True when the provider limited this page (rate budget, page cap, retention)
   * so the client shows the transcript as visibly partial rather than complete. */
  partial: boolean;
  /** When the next request would be refused before this many ms pass. */
  retryAfterMs?: number;
}

export interface ThreadPage {
  root: BackendMessage;
  replies: BackendMessage[];
  cursor: string | null;
  partial: boolean;
  retryAfterMs?: number;
}

export interface SendMessageInput {
  channelId: string;
  body: string;
  /** Client-generated idempotency key; echoed back by the provider so a
   * timeout can be reconciled without a blind retry. */
  clientMsgId: string;
  threadRootId?: string | null;
  fileIds?: string[];
  /** Explicit mention targets (Flow); providers that derive mentions from the
   * body ignore it. */
  mentions?: string[];
}

export interface SendReceipt {
  message: BackendMessage;
}

export interface SearchResult {
  messages: BackendMessage[];
  cursor: string | null;
  partial: boolean;
}

// ---- events -----------------------------------------------------------------

export type BackendEvent =
  | { type: 'message.created'; message: BackendMessage }
  | { type: 'message.updated'; message: BackendMessage }
  | { type: 'message.deleted'; channelId: string; messageId: string; threadRootId: string | null }
  | { type: 'thread.reply'; message: BackendMessage }
  | { type: 'reaction.added' | 'reaction.removed'; channelId: string; messageId: string; emoji: string; userId: string }
  | { type: 'channel.updated'; channel: BackendChannel }
  | { type: 'channel.read'; channelId: string; lastReadMsgId: string | null }
  | { type: 'typing'; channelId: string; userId: string; threadRootId?: string | null }
  | { type: 'presence'; userId: string; online: boolean }
  | { type: 'auth.changed'; auth: BackendAuthState }
  | { type: 'capabilities.changed'; capabilities: Capabilities }
  /** The live stream is degraded: events may be missing until `resumesAt`.
   * Clients show an honest "delayed" state and reconcile by refetch. */
  | { type: 'stream.degraded'; reason: string; resumesAtMs: number | null }
  | { type: 'stream.recovered' };

export type BackendEventHandler = (event: BackendEvent) => void;

// ---- the contract -----------------------------------------------------------

export interface WorkspaceBackend {
  readonly provider: BackendProvider;
  readonly connectionId: string;

  auth(): BackendAuthState;
  capabilities(): Capabilities;
  /** The signed-in identity as the UI's user model. Providers without a Flow
   * account synthesize it from their own identity (no email, default prefs). */
  me(): Promise<UserDTO>;
  /** End this client's session with the provider; the connection record and
   * any other client's session are untouched. */
  signOut(): Promise<void>;

  listWorkspaces(): Promise<WorkspaceDTO[]>;
  listConversations(workspaceId: string): Promise<BackendChannel[]>;
  listMembers(workspaceId: string): Promise<WorkspaceMemberDTO[]>;

  /** Older messages before `cursor` (null = latest page). Oldest first. */
  history(channelId: string, options: { cursor: string | null; limit: number }): Promise<HistoryPage>;
  thread(channelId: string, rootId: string, options?: { cursor: string | null }): Promise<ThreadPage>;

  send(input: SendMessageInput): Promise<SendReceipt>;
  edit(channelId: string, messageId: string, body: string): Promise<BackendMessage>;
  /** `purge` asks for a hard delete where the provider distinguishes one (Flow). */
  delete(channelId: string, messageId: string, options?: { purge?: boolean }): Promise<void>;
  setReaction(channelId: string, messageId: string, emoji: string, on: boolean): Promise<void>;
  /** With `threadRootId` it means "I am looking at this thread" (Flow keeps a
   * separate cursor for replies); providers without that ignore it. */
  markRead(channelId: string, messageId: string, options?: { threadRootId?: string }): Promise<void>;

  /** `file` is a Blob/File in browsers; typed loosely so this package stays DOM-free. */
  uploadFile(target: { workspaceId: string; channelId: string }, file: { size: number; type: string; name?: string }): Promise<FileDTO>;
  fileUrl(file: FileDTO): string | null;

  search(query: string, options?: { cursor: string | null }): Promise<SearchResult>;

  /** Subscribe to the normalized stream; returns the unsubscribe function. */
  subscribe(handler: BackendEventHandler): () => void;

  /** Deep link for "Open in <provider>", or null when the provider has none. */
  openUrl(target: { channelId: string; messageId?: string }): string | null;
}

// ---- errors -----------------------------------------------------------------

export type BackendErrorCode =
  | 'unsupported'          // capability unavailable; never retried, never re-routed
  | 'rate_limited'         // retryAfterMs set; the client waits and says so
  | 'unauthorized'         // reauthorization required
  | 'not_found'
  | 'invalid'
  | 'timeout'              // outcome unknown: reconcile by clientMsgId/ts before retrying
  | 'provider_error';

export class BackendError extends Error {
  readonly code: BackendErrorCode;
  readonly retryAfterMs: number | undefined;
  readonly providerCode: string | undefined;
  constructor(code: BackendErrorCode, message: string, options: { retryAfterMs?: number; providerCode?: string } = {}) {
    super(message);
    this.name = 'BackendError';
    this.code = code;
    this.retryAfterMs = options.retryAfterMs;
    this.providerCode = options.providerCode;
  }
}

// ---- identity helpers -------------------------------------------------------

/** Slack's message timestamp string: seconds, a dot, six digits. It is an
 * identifier, not a number; it is never parsed for arithmetic and never
 * reformatted. */
export const SLACK_TS_RE = /^\d{9,11}\.\d{6}$/;

export function isSlackTs(value: unknown): value is string {
  return typeof value === 'string' && SLACK_TS_RE.test(value);
}

export function assertSlackTs(value: unknown): string {
  if (!isSlackTs(value)) throw new BackendError('invalid', `not a Slack ts string: ${typeof value === 'number' ? 'number' : JSON.stringify(value)}`);
  return value;
}

/** A Slack message's identity inside Flow: connection, team, channel and the
 * exact `ts`. The `messageId` used in normalized DTOs is the `ts` itself,
 * scoped by channel — so two teams sharing a `ts` can never collide in a
 * cache that is already namespaced per connection. */
export interface SlackMessageKey {
  connectionId: string;
  teamId: string;
  channelId: string;
  ts: string;
}

export function slackMessageKey(connectionId: string, teamId: string, channelId: string, ts: string): SlackMessageKey {
  return { connectionId, teamId, channelId, ts: assertSlackTs(ts) };
}

/** Stable string form for cache keys and events; `ts` survives verbatim. */
export function slackMessageKeyString(key: SlackMessageKey): string {
  return `slack:${key.connectionId}:${key.teamId}:${key.channelId}:${key.ts}`;
}

/** Slack provider identity tuple, serialized for `providerIdentity` fields.
 * Two teams at slack.com never deduplicate into one connection. */
export interface SlackIdentityTuple {
  environment: 'slack' | 'slack-gov';
  enterpriseId: string | null;
  teamId: string;
  userId: string;
}

export function slackIdentityString(identity: SlackIdentityTuple): string {
  return JSON.stringify([identity.environment, identity.enterpriseId, identity.teamId, identity.userId]);
}

/** ISO timestamp for display from a Slack `ts` — display only; the `ts`
 * string remains the identity. Integer math on the two halves, no floats. */
export function slackTsToIso(ts: string): string {
  const [seconds, micros] = assertSlackTs(ts).split('.');
  const ms = Number(seconds) * 1000 + Math.floor(Number(micros) / 1000);
  return new Date(ms).toISOString();
}

/** Page contents from a provider that could cross pages, deduplicated by id
 * while preserving order — the Slack connector may deliver an event for a
 * message that a lazy history page also contains. */
export function dedupeMessages<T extends { id: string }>(messages: T[]): T[] {
  const seen = new Set<string>();
  return messages.filter(m => (seen.has(m.id) ? false : (seen.add(m.id), true)));
}

export type { MessagePage };
