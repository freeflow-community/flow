// App-level contexts: auth, selection, and ephemeral live state
// (presence/typing/connection/unread-notifications).
import { createContext, useContext } from 'react';
import type { UserDTO } from '@flow/shared';
import type { SocketStatus } from './lib/ws';

export interface AuthState {
  user: UserDTO;
  setUser(u: UserDTO): void;
  signOut(): void;
}

export interface Selection {
  workspaceId: string | null;
  channelId: string | null;
  threadRootId: string | null;
  selectWorkspace(id: string | null): void;
  selectChannel(id: string | null): void;
  openThread(id: string | null): void;
}

export interface LiveState {
  status: SocketStatus;
  presence: Record<string, boolean>;
  typing: Record<string, Record<string, number>>; // channelId -> userId -> ts(ms)
  notificationUnread: number;
  setNotificationUnread(n: number): void;
  sendTyping(channelId: string): void;
}

export const AuthContext = createContext<AuthState | null>(null);
export const SelectionContext = createContext<Selection | null>(null);
export const LiveContext = createContext<LiveState | null>(null);

export function useAuth(): AuthState {
  const v = useContext(AuthContext);
  if (!v) throw new Error('AuthContext missing');
  return v;
}
export function useSelection(): Selection {
  const v = useContext(SelectionContext);
  if (!v) throw new Error('SelectionContext missing');
  return v;
}
export function useLive(): LiveState {
  const v = useContext(LiveContext);
  if (!v) throw new Error('LiveContext missing');
  return v;
}
