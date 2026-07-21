import type { AgentPairingRequestDTO, ChannelDTO, MessageDTO, NotificationDTO, UserDTO, WorkspaceMemberDTO } from './dto.js';

// WS event envelope, per phase1.md §3
export type EventType =
  | 'message.created'
  | 'message.updated'
  | 'message.deleted'
  | 'thread.reply'
  | 'typing'
  | 'presence'
  | 'channel.created'
  | 'channel.updated' // rename / topic change (ui_nits item 5)
  | 'channel.archived'
  | 'member.joined'
  | 'member.left'
  | 'member.updated' // workspace role change (admin panel)
  | 'reaction.added'
  | 'reaction.removed'
  | 'notification.created' // per-user notify subject (phase 2 §4)
  | 'agent.pairing' // per-user notify subject: an agent asked this user to sponsor it (AGENT_MEMBERS.md)
  | 'user.updated' // meta subject of every workspace the user belongs to
  | 'workspace.updated' // meta subject; workspace-level changes (e.g. sidebar color)
  | 'workspace.joined'; // per-user subject; consumed by the gateway, not forwarded to clients

export interface Event<T = unknown> {
  type: EventType;
  workspaceId: string;
  channelId?: string;
  ts: string; // ISO
  data: T;
}

export interface TypingData {
  userId: string;
  channelId: string;
}

export interface PresenceData {
  userId: string;
  status: 'online' | 'offline';
}

export interface ReactionEventData {
  messageId: string;
  channelId: string;
  emoji: string;
  userId: string;
}

export interface MemberLeftData {
  userId: string;
  channelId: string;
  workspaceId: string;
}

export type MessageEventData = MessageDTO;
export type ChannelCreatedData = ChannelDTO;
export type ChannelUpdatedData = ChannelDTO;
export type ChannelArchivedData = ChannelDTO;
export type MemberJoinedData = WorkspaceMemberDTO;
export type MemberUpdatedData = WorkspaceMemberDTO;
export type NotificationCreatedData = NotificationDTO;
export type AgentPairingData = AgentPairingRequestDTO;
export type UserUpdatedData = UserDTO;

// ---- WS protocol frames (phase1.md §4) --------------------------
export type ClientFrame =
  | { op: 'auth'; token: string }
  | { op: 'typing'; channelId: string }
  | { op: 'pong' };

export type ServerFrame =
  | { op: 'hello'; sessionId: string }
  | { op: 'event'; event: Event }
  | { op: 'ping' }
  | { op: 'error'; code: string; message: string };
