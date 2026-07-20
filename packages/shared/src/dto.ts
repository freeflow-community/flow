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
  createdAt: string;
}

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
  role: MemberRole;
  joinedAt: string;
}

export interface InviteDTO {
  id: string;
  workspaceId: string;
  email: string;
  inviteUrl: string; // flow://invite/<token> — raw token returned once
  expiresAt: string;
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
  /** first (up to) 4 distinct reply authors in thread order — drives the reply-avatar stack */
  replyParticipantUserIds: string[];
  reactions: ReactionAggDTO[];
  files: FileDTO[];
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

// ---- First-class AI agents (AGENTS_DESIGN.md) -------------------

/** Agent invite (owner/admin). The raw key is returned exactly once. */
export interface AgentInviteDTO {
  id: string;
  workspaceId: string;
  nameHint: string | null;
  /** `flow-agent-<token>` — shown once, only the hash is stored. */
  key: string;
  expiresAt: string;
}

/** Response of POST /v1/agents/register. The agent token is returned exactly once. */
export interface AgentRegisterResponse {
  /** Non-expiring bearer token (`flow-agent-token-<token>`) — shown once, only the hash is stored. */
  agentToken: string;
  user: UserDTO;
  workspace: WorkspaceDTO;
}
