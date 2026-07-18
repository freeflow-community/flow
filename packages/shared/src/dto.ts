// Plain DTO types returned by the REST API. All timestamps are ISO-8601 strings.

export interface UserDTO {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  createdAt: string;
}

export interface WorkspaceDTO {
  id: string;
  slug: string;
  name: string;
  createdBy: string;
  createdAt: string;
  role?: MemberRole; // present on "my workspaces"
}

export type MemberRole = 'owner' | 'admin' | 'member';

export interface WorkspaceMemberDTO {
  userId: string;
  displayName: string;
  email: string;
  avatarUrl: string | null;
  role: MemberRole;
  joinedAt: string;
}

export interface InviteDTO {
  id: string;
  workspaceId: string;
  email: string;
  inviteUrl: string; // myapp://invite/<token> — raw token returned once
  expiresAt: string;
}

export interface ChannelDTO {
  id: string;
  workspaceId: string;
  name: string;
  topic: string | null;
  isPrivate: boolean;
  createdBy: string;
  createdAt: string;
  archivedAt: string | null;
  isMember: boolean;
  lastReadMsgId: string | null;
  unreadCount: number;
}

export interface MessageDTO {
  id: string;
  channelId: string;
  userId: string;
  threadRootId: string | null;
  clientMsgId: string;
  body: string; // plaintext — decrypted server-side
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  replyCount: number;
  lastReplyAt: string | null;
}

export interface AuthResponse {
  token: string;
  user: UserDTO;
}

export interface MessagePage {
  messages: MessageDTO[];
  hasMore: boolean;
}
