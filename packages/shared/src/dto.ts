// Plain DTO types returned by the REST API. All timestamps are ISO-8601 strings.

export interface UserDTO {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  timezone: string; // IANA name, default UTC
  statusEmoji: string; // '' = no status
  statusText: string; // '' = no status
  /** First-class AI agent (AGENTS_DESIGN.md) — clients render a small 🤖 next to the name. */
  isAgent: boolean;
  /** Agents only: the human member who sponsored (approved) the agent. null for
   * humans and unsponsored agents. Mirrors WorkspaceMemberDTO.sponsorId so a
   * profile card fetched via /v1/users/:id can show the sponsor without the roster. */
  sponsorId: string | null;
  /** Per-user notification prefs (phase 10). Missing key = on. */
  notificationPrefs: NotificationPrefs;
  /** While true, all notification alerts are suppressed (status-driven DND). */
  statusSuppressAlerts: boolean;
  createdAt: string;
}

/** Per-user notification preferences (phase 10). All optional; absent = default (on/off as noted). */
export interface NotificationPrefs {
  /** DM + group-DM messages (kind 1). Default on. */
  dm?: boolean | undefined;
  /** Direct <@user> mentions (kind 0, subkind 'mention'). Default on. */
  mention?: boolean | undefined;
  /** <!here>/<!channel>/<!everyone> group mentions (kind 0, subkind 'here'/'channel'). Default on. */
  groupMention?: boolean | undefined;
  /** Replies to threads the user started or participated in (kind 2). Default on. */
  threadReply?: boolean | undefined;
  /** Web-only presentation pref: OS notifications persist until dismissed (requireInteraction). Default off. */
  persistentBanners?: boolean | undefined;
}

/** Why a kind-0 (mention) notification fired: direct mention vs group-mention variant. */
export type NotificationSubkind = 'mention' | 'here' | 'channel';

export interface WorkspaceDTO {
  id: string;
  slug: string;
  name: string;
  createdBy: string;
  createdAt: string;
  sidebarColor: string; // preset id from SIDEBAR_COLORS (phase 3.5)
  role?: MemberRole; // present on "my workspaces"
}

export type MemberRole = 'owner' | 'admin' | 'member';

export interface WorkspaceMemberDTO {
  userId: string;
  displayName: string;
  email: string;
  avatarUrl: string | null;
  statusEmoji: string; // '' = no status
  statusText: string;
  /** First-class AI agent (AGENTS_DESIGN.md) — clients render a small 🤖 next to the name. */
  isAgent: boolean;
  /** Agents only: the human member who sponsored (approved) the agent and is responsible for it. */
  sponsorId: string | null;
  role: MemberRole;
  joinedAt: string;
}

export interface InviteDTO {
  id: string;
  workspaceId: string;
  email: string;
  inviteUrl: string; // <INVITE_URL_BASE><token> — raw token returned once
  expiresAt: string;
  /** true when the invite email was sent to `email` (send failures leave the invite valid). */
  emailSent?: boolean;
}

export type ChannelKind = 'standard' | 'dm' | 'group_dm';

/** channel_members.notify_level: 0=mute, 1=mentions (default), 2=all */
export type NotifyLevel = 0 | 1 | 2;

export interface ChannelDTO {
  id: string;
  workspaceId: string;
  name: string | null; // null for dm/group_dm channels
  kind: ChannelKind;
  topic: string | null;
  isPrivate: boolean;
  createdBy: string;
  createdAt: string;
  archivedAt: string | null;
  isMember: boolean;
  lastReadMsgId: string | null;
  unreadCount: number;
  notifyLevel: NotifyLevel;
  /** Member user ids — populated for dm/group_dm channels only (clients render DM names from these). */
  memberIds?: string[];
}

export interface ReactionAggDTO {
  emoji: string; // unicode emoji
  count: number;
  userIds: string[];
}

export interface FileDTO {
  id: string;
  workspaceId: string;
  userId: string;
  name: string; // original filename
  mimeType: string;
  sizeBytes: number;
  width: number | null; // images only
  height: number | null;
  hasThumb: boolean;
  createdAt: string;
}

/** Response of POST /v1/workspaces/:id/files/presign: upload the bytes to
 * `upload.url` with the given method/headers, then POST /v1/files/:id/complete. */
export interface PresignedUploadDTO {
  file: FileDTO;
  upload: {
    url: string; // absolute (R2) or server-relative (local-dev fallback, needs auth header)
    method: 'PUT';
    headers: Record<string, string>;
  };
}

/** Phase 13: a per-channel shared artifact — a named file pinned to a channel,
 * shown nested under that channel in the sidebar and opened in the side panel.
 * Everyone in the channel sees it (privacy = use a private channel). The
 * backing file is mutable: an agent "updates" an artifact by re-pointing it at
 * a freshly uploaded file. */
export interface ArtifactDTO {
  id: string;
  workspaceId: string;
  channelId: string; // the channel this artifact belongs to (shared with all members)
  /** 'file' — a pinned file (the original kind); 'link' — a pinned URL opened in
   * the shared co-browsing mini-browser. Discriminates which fields are set. */
  kind: 'file' | 'link';
  fileId: string | null; // set when kind==='file'
  /** The pinned URL when kind==='link'. Mutable: any member changing it in the
   * mini-browser re-points the artifact and everyone's viewer follows (co-browse). */
  url: string | null;
  name: string; // display name, defaults to the file name or the link host
  /** True when the artifact owns its backing file — i.e. an agent generated the
   * content via the Flow MCP (uploaded a fresh blob) rather than a human pinning
   * an existing message file. Clients use this to auto-open agent-created
   * artifacts for the requester (a human pin does not steal focus). Always false
   * for link artifacts. */
  ownsFile: boolean;
  createdAt: string;
  updatedAt: string; // bumped when the name, backing file, or link url changes
  /** The underlying file, hydrated so clients can render without a second fetch.
   * Null for link artifacts. */
  file: FileDTO | null;
}

/** Phase 11 §8 link preview card. All fields except `url` and `type` are
 * optional — clients render whatever is present and must tolerate absences.
 *
 * NOTE (server core pass): images are not proxied yet (§6), so `image` is
 * absent on every card today. Cards render text-only until the proxy lands;
 * clients should already handle `image` being present so no client change is
 * needed when it does. */
export interface UnfurlDTO {
  /** The normalized URL this card is keyed on. */
  url: string;
  /** sha256(normalized url) — the id used to delete an individual unfurl. */
  urlHash: string;
  canonicalUrl?: string;
  type: 'link' | 'image' | 'video' | 'audio' | 'file';
  layout?: 'thumbnail' | 'large_image' | 'media';
  siteName?: string;
  faviconUrl?: string;
  title?: string;
  description?: string;
  author?: string;
  publishedAt?: string;
  image?: {
    url: string;
    thumbUrl?: string;
    width?: number;
    height?: number;
    alt?: string;
  };
  media?: {
    provider?: string;
    durationSec?: number;
  };
  fetchedAt: string;
  expiresAt: string;
}

/** Channel event lines rendered inline in the stream (join/leave notices). */
export type SystemMessageKind = 'member_joined' | 'member_left';

export interface MessageDTO {
  id: string;
  channelId: string;
  userId: string;
  threadRootId: string | null;
  clientMsgId: string;
  body: string; // plaintext — decrypted server-side; mentions stored as <@userId>, group mentions as <!channel|here|everyone>
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  replyCount: number;
  lastReplyAt: string | null;
  /** Non-null marks a channel event line (join/leave) rather than a user message.
   * The `body` is the pre-rendered sentence ("Alice joined the channel"); clients
   * render it as a centered, muted notice with no avatar/header. Null = a normal
   * message. */
  systemKind: SystemMessageKind | null;
  /** first (up to) 4 distinct reply authors in thread order — drives the reply-avatar stack */
  replyParticipantUserIds: string[];
  reactions: ReactionAggDTO[];
  files: FileDTO[];
  /** Phase 11: link preview cards, in first-in-message order. Empty when the
   * message has no links, unfurling is off, or the worker hasn't finished —
   * cards arrive later via a `message.updated` event. */
  unfurls: UnfurlDTO[];
}

/** notifications.kind: 0=mention (incl. group mentions), 1=dm, 2=thread_reply, 3=channel activity (notify_level=all) */
export type NotificationKind = 0 | 1 | 2 | 3;

export interface NotificationDTO {
  id: string;
  userId: string;
  messageId: string;
  channelId: string;
  workspaceId: string;
  kind: NotificationKind;
  /** For kind 0: what fired the mention (null for other kinds and legacy rows). */
  subkind: NotificationSubkind | null;
  /**
   * Server-computed at fan-out/list time (phase 10): true when the user's
   * prefs or a suppressing status say NO OS banner for this notification.
   * The row/bell entry exists regardless — this gates alerts only.
   */
  suppressAlert: boolean;
  createdAt: string;
  readAt: string | null;
  /** The triggering message, for banner text / list rendering. */
  message: MessageDTO;
}

export interface NotificationPage {
  notifications: NotificationDTO[];
  hasMore: boolean;
  unreadCount: number;
}

export interface AuthResponse {
  token: string;
  user: UserDTO;
}

/** Registration that must be completed by clicking the emailed verify link. */
export interface RegisterPendingResponse {
  requiresVerification: true;
  email: string;
}

export type RegisterResponse = AuthResponse | RegisterPendingResponse;

export interface MessagePage {
  messages: MessageDTO[];
  hasMore: boolean;
}

// ---- Phase 4: Slack app compatibility ---------------------------

/** Slack-compat app registration (phase4.md §1). Bot token is returned once at creation. */
export interface AppDTO {
  id: string;
  workspaceId: string;
  name: string;
  botUserId: string;
  eventUrl: string | null;
  eventTypes: string[];
  createdBy: string;
  createdAt: string;
  disabledAt: string | null;
  /** true once the event_url answered the url_verification challenge */
  eventUrlVerified: boolean;
}

// ---- First-class AI agents (AGENT_MEMBERS.md) -------------------

/** Response of POST /v1/workspaces/:id/agent-invites: a one-time invite code the
 *  sponsor hands to their agent. The raw code is shown once (only its hash is stored). */
export interface AgentInviteDTO {
  /** The one-time invite code (`flow-XXXX-XXXX`). */
  code: string;
  /** Ready-to-run command: `npx flow-agent-bridge <code>`. */
  command: string;
  expiresAt: string;
}

/** Response of POST /v1/agents/redeem: the invite created the agent and it's in. */
export interface AgentRedeemResponse {
  /** Non-expiring bearer token (`flow-agent-token-<token>`) — shown once, only the hash is stored. */
  agentToken: string;
  user: UserDTO;
  workspace: WorkspaceDTO;
}

/** Response of POST /v1/agents/login (username + key → fresh token; prior tokens revoked). */
export interface AgentLoginResponse {
  agentToken: string;
  user: UserDTO;
}
