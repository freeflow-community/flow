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

/**
 * Sentinel channel id for the admin panel — a virtual, client-only sidebar
 * entry (no real channel/membership). When it's the active selection, the
 * content pane renders <AdminView> instead of a message stream.
 */
export const ADMIN_VIEW_ID = '__admin__';

export interface Selection {
  workspaceId: string | null;
  channelId: string | null;
  threadRootId: string | null;
  /** Selected artifact tab (phase 9) — when set, the content pane shows the
   * artifact panel; takes precedence over channelId (which stays put so
   * closing the artifact returns to the last channel). */
  artifactId: string | null;
  /** Message being edited inline (hover menu or composer ↑) — ui_nits item 4. */
  editingMessageId: string | null;
  /** Admin panel pinned into the channel list (admins only; per-device). */
  adminPanelOpen: boolean;
  selectWorkspace(id: string | null): void;
  selectChannel(id: string | null): void;
  selectArtifact(id: string | null): void;
  openThread(id: string | null): void;
  setEditingMessage(id: string | null): void;
  /** Pin the admin row into the sidebar and open it (from the workspace menu). */
  openAdminPanel(): void;
  /** Unpin/close the admin row (its "close like any other channel" affordance). */
  closeAdminPanel(): void;
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
