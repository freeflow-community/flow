import type { ChannelDTO, MessageDTO, WorkspaceMemberDTO } from './dto.js';

// WS event envelope, per phase1.md §3
export type EventType =
  | 'message.created'
  | 'message.updated'
  | 'message.deleted'
  | 'thread.reply'
  | 'typing'
  | 'presence'
  | 'channel.created'
  | 'member.joined';

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

export type MessageEventData = MessageDTO;
export type ChannelCreatedData = ChannelDTO;
export type MemberJoinedData = WorkspaceMemberDTO;

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
