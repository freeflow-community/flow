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

/**
 * Sentinel channel id for the Activity feed (phase 12) — an always-present,
 * virtual per-user "channel" that replaces the notifications bell. When it's
 * the active selection the content pane renders <ActivityView>, which surfaces
 * this user's notification rows (mentions/DMs/thread replies/activity) as a
 * message-like stream. Not a real channel — there is no server row.
 */
export const ACTIVITY_VIEW_ID = '__activity__';

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
  /** Message to scroll to + flash after navigation (phase 12 Activity feed
   * jump-to-message). The channel/thread view pages history until it's loaded,
   * scrolls to it, then clears this. */
  focusMessageId: string | null;
  /** Admin panel pinned into the channel list (admins only; per-device). */
  adminPanelOpen: boolean;
  selectWorkspace(id: string | null): void;
  selectChannel(id: string | null): void;
  selectArtifact(id: string | null): void;
  openThread(id: string | null): void;
  setEditingMessage(id: string | null): void;
  /** Navigate to a specific message: selects its channel (and thread, if any)
   * and marks it as the scroll-to + flash target. */
  jumpToMessage(channelId: string, messageId: string, threadRootId?: string | null): void;
  /** Clear the scroll-to target once it's been reached (or given up on). */
  clearFocusMessage(): void;
  /** Pin the admin row into the sidebar and open it (from the workspace menu). */
  openAdminPanel(): void;
  /** Unpin/close the admin row (its "close like any other channel" affordance). */
  closeAdminPanel(): void;
}

export interface LiveState {
  status: SocketStatus;
  presence: Record<string, boolean>;
  /** typingKey(channelId, threadRootId) -> userId -> ts(ms). Keyed by composer,
   * not by channel, so a thread's indicator never shows in the main view. */
  typing: Record<string, Record<string, number>>;
  notificationUnread: number;
  setNotificationUnread(n: number): void;
  sendTyping(channelId: string, threadRootId?: string): void;
}

/**
 * Mobile navigation state (responsive layout): below the `md` breakpoint the
 * rail + sidebar collapse into a slide-in drawer over a full-width content
 * pane. `isMobile` mirrors the `(max-width: 767px)` media query; the drawer is
 * always "open" (in flow) on desktop.
 */
export interface MobileNav {
  isMobile: boolean;
  drawerOpen: boolean;
  openDrawer(): void;
  closeDrawer(): void;
}

/** Typing indicators are per-composer: a channel's main composer and each of
 * its threads are separate conversations and get separate keys. */
export function typingKey(channelId: string, threadRootId?: string | null): string {
  return `${channelId}|${threadRootId ?? ''}`;
}

export const AuthContext = createContext<AuthState | null>(null);
export const SelectionContext = createContext<Selection | null>(null);
export const LiveContext = createContext<LiveState | null>(null);
export const MobileNavContext = createContext<MobileNav | null>(null);

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
export function useMobileNav(): MobileNav {
  const v = useContext(MobileNavContext);
  if (!v) throw new Error('MobileNavContext missing');
  return v;
}
