// Plain DTO types returned by the REST API. All timestamps are ISO-8601 strings.

export interface UserDTO {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  timezone: string; // IANA name, default UTC
  statusEmoji: string; // '' = no status
  statusText: string; // '' = no status
  /** Personal website (#220). '' = none. Always an absolute http(s) URL — the
   * server rejects every other scheme, so clients may link it directly (with
   * rel="noreferrer noopener"). */
  website: string;
  /** Free-text bio (#220). '' = none. **Plain text**, not markdown: newlines are
   * significant, everything else renders literally. Render it in a node that
   * escapes (a React text child, SwiftUI Text) — never as HTML. */
  bio: string;
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
  /** Reactions on my own messages (kind 4). Default on. */
  reaction?: boolean | undefined;
  /** Someone added me to a channel (kind 5). Default on. Deliberately its own
   * key rather than sharing `mention`: muting mentions must not silently mute
   * invites, which are the only signal that new work has arrived. */
  channelInvite?: boolean | undefined;
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
  /** #336: optional workspace avatar, an authenticated `/v1/avatars/<key>`
   * path (same route user avatars use). null = draw the color/initial mark. */
  avatarUrl: string | null;
  /** Phase 16 §5a: when set, any Google user with a *verified* email on this
   * domain self-enrols on sign-in — no invite. null = off (the default). */
  googleSelfRegisterDomain: string | null;
  role?: MemberRole; // present on "my workspaces"
  /** #345: unread messages across the channels I'm a member of in this
   * workspace — the number the sidebar rail badge shows. Muted and archived
   * channels don't contribute. Present on "my workspaces" only; absent
   * elsewhere means "not computed", not zero. */
  unreadCount?: number;
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
  /** App/integration bot user. Like `isAgent`, it means "not a person" — which
   * is what the sole-human check behind Delete workspace turns on. */
  isBot: boolean;
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

/**
 * The workspace's persistent join link (issue #85). One live link at a time:
 * regenerating replaces it and revoking removes it, so `joinUrl: null` means
 * "no link right now — generate one".
 */
export interface JoinLinkDTO {
  workspaceId: string;
  /** `<WEB_URL_BASE>/join/<workspace slug>/<token>`, or null when none exists. */
  joinUrl: string | null;
  createdBy?: string;
  createdAt?: string;
}

/** Unauthenticated preview of a join link, so the join page can name the
 * workspace before the visitor signs in. */
export interface JoinLinkPreviewDTO {
  workspaceId: string;
  slug: string;
  name: string;
}

export type ChannelKind = 'standard' | 'dm' | 'group_dm';

/** channel_members.notify_level: 0=mute, 1=mentions (default), 2=all */
export type NotifyLevel = 0 | 1 | 2;

/**
 * What a channel's activity indicator is showing (#137). One state today —
 * `busy`, a spinner, set by an agent while it works on a turn. Clients render
 * any non-null state as the spinner, so adding a state later doesn't strand
 * older clients on a blank row.
 */
export type ChannelIndicatorState = 'busy';

/** One participant in a channel's live voice huddle (Phase 1: audio-only). */
export interface HuddleParticipantDTO {
  userId: string;
  joinedAt: string; // ISO
}

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
  /**
   * Unread *messages* — drives the bold state of the sidebar row, never a
   * number on screen (operator ruling 2026-07-26): a count means "this needs
   * you", and a busy channel you're not in the middle of doesn't.
   */
  unreadCount: number;
  /**
   * Unread *notifications* raised in this channel (mentions, thread replies,
   * reactions — and every message in a DM). This is the number the sidebar
   * badge shows, and these sum to the Activity row's total.
   */
  unreadNotifications: number;
  /**
   * Thread roots in this channel with an unread notification for me (#270) —
   * clients put a dot on the root's "N replies" chip, so a reply that needs
   * you is visible in the transcript and not only in the sidebar badge.
   * Empty for a non-member, and cleared for a thread once you open it.
   */
  unreadThreadRootIds: string[];
  notifyLevel: NotifyLevel;
  /**
   * Parent channel (#118) — set at creation, one level deep, so clients can
   * render this channel indented under its parent. Null for a top-level
   * channel, and for every DM. A child is an ordinary channel in every other
   * respect: its own membership, privacy and unreads.
   */
  parentId: string | null;
  /** Member user ids — populated for dm/group_dm channels only (clients render DM names from these). */
  memberIds?: string[];
  /**
   * Live activity indicator (#137) — an agent working in this channel spins a
   * small icon on its sidebar row. Transient server state, never a DB column
   * (see `indicators.ts`): it expires, and clears when its setter disconnects.
   * Present on the channel list so a fresh client starts in the right state;
   * `channel.indicator` events carry every change after that.
   */
  indicator?: ChannelIndicatorState | null;
  /**
   * Live voice huddle participants (Phase 1) — ambient, per-channel audio call.
   * Transient server state, never a DB column (see `huddles.ts`): LiveKit is
   * the source of truth, this is a cache of it. Present on the channel list so
   * a fresh client shows an already-active huddle; `huddle.updated` events
   * carry every change after that. Absent/empty means no active huddle.
   */
  huddleParticipants?: HuddleParticipantDTO[];
}

export interface ReactionAggDTO {
  emoji: string; // unicode emoji
  count: number;
  userIds: string[];
}

/** A workspace custom emoji (#175). `emoji` is the `:shortcode:` form — exactly
 * the string a reaction row stores — so clients can key their lookup map on it
 * directly. The image is fetched from `/v1/files/{fileId}` like any other. */
export interface WorkspaceEmojiDTO {
  id: string;
  workspaceId: string;
  shortcode: string; // bare, no colons
  emoji: string; // `:shortcode:`
  fileId: string;
  createdBy: string;
  createdAt: string;
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

/** One row of the channel Files panel (#347): a file attached to a live
 * message in the channel. `messageId` is the message it was shared in, so a
 * client can jump to it; a file shared twice appears once per message. */
export interface ChannelFileDTO {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  hasThumb: boolean;
  /** who uploaded it — id plus a display name so a row renders without a roster */
  userId: string;
  uploaderName: string;
  /** when the file was shared (the message's timestamp) */
  createdAt: string;
  messageId: string;
}

export type ChannelFileSort = 'newest' | 'oldest' | 'name' | 'size';

/** GET /v1/channels/:id/files. `nextCursor` is opaque — hand it straight back
 * as `before` for the next page; null means the list is exhausted. */
export interface ChannelFilePage {
  files: ChannelFileDTO[];
  total: number;
  nextCursor: string | null;
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
  /** Present when the link is a video we can play inside Flow. The player URL
   * is built by the server from the parsed `videoId` — the provider's own
   * oEmbed `html` is never forwarded — so a client renders a frame it was
   * handed, not third-party markup it has to trust. Clients show a play badge
   * and only load `playerUrl` once the viewer asks for it. `playerUrl` carries
   * no query string, so appending `?autoplay=1` is safe. */
  embed?: {
    provider: 'youtube';
    videoId: string;
    playerUrl: string;
    width?: number;
    height?: number;
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
  /** Channel-wide pin metadata. Null means the message is not currently
   * pinned; any channel member may pin or unpin a live message. */
  pinnedAt: string | null;
  pinnedBy: string | null;
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

/**
 * notifications.kind: 0=mention (incl. group mentions), 1=dm, 2=thread_reply,
 * 3=channel activity (notify_level=all), 4=reaction on one of my messages,
 * 5=someone added me to a channel (#303)
 */
export type NotificationKind = 0 | 1 | 2 | 3 | 4 | 5;

export interface NotificationDTO {
  id: string;
  userId: string;
  messageId: string;
  channelId: string;
  workspaceId: string;
  kind: NotificationKind;
  /**
   * Who caused it — the message author for kinds 0-3, the reactor for kind 4.
   * Null only for legacy rows written before the column existed.
   */
  actorId: string | null;
  /** kind 4 only: the emoji that was added to my message. */
  reactionEmoji: string | null;
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
  /**
   * Unread rows in the requested scope — this workspace when the query carried
   * a `workspaceId`, every workspace otherwise. Drives the in-workspace
   * Activity badge.
   */
  unreadCount: number;
  /**
   * Unread rows across every workspace, regardless of scope. Drives the OS app
   * icon badge, which must still speak for workspaces you aren't looking at.
   */
  totalUnreadCount: number;
}

export interface AuthResponse {
  token: string;
  user: UserDTO;
}

/**
 * Response of POST /v1/auth/google and /v1/auth/apple. A normal session plus
 * the workspaces the sign-in auto-enrolled the user into via domain
 * self-registration (phase16 §4) — the client uses it to route straight in
 * instead of showing the empty create-workspace screen.
 */
export interface OAuthSignInResponse extends AuthResponse {
  autoJoined: WorkspaceDTO[];
}

/** Historical name from when Google was the only OAuth provider. */
export type GoogleAuthResponse = OAuthSignInResponse;

/** GET /v1/config — the small public bootstrap payload the signed-out web app
 * reads so it knows which auth options to render. No secrets: a Google OAuth
 * client id is public by design (it ships in the page that calls Google). */
export interface PublicConfigDTO {
  /** Google sign-in is configured server-side. */
  google: boolean;
  /** OAuth 2.0 Web client id for Google Identity Services; null when disabled. */
  googleClientId: string | null;
  /** Sign in with Apple is configured server-side (native iOS flow). */
  apple: boolean;
  /** Largest file the presigned upload path accepts, in bytes. Public so a
   * client can refuse an over-size file before the round trip and say what the
   * limit is — the iOS share extension does this for videos (issue #219). */
  maxFileBytes: number;
}

/** GET /v1/me/identities — external identities linked to the signed-in user.
 * Drives the "offer the domain toggle" decision on the client (phase16 §5a). */
export interface OAuthIdentityDTO {
  provider: 'google' | 'apple';
  /** The verified email the provider asserted at the last sign-in. */
  email: string;
  /** Google Workspace hosted domain, when the account has one (Google only). */
  hostedDomain: string | null;
  linkedAt: string;
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
