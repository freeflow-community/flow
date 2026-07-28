import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ArtifactDTO, UserDTO, AuthResponse, WorkspaceDTO } from '@flow/shared';
import { api, getToken, setToken } from './lib/api';
import { clearJoinToken, parseJoinPath, readJoinToken, stashJoinToken } from './lib/joinLink';
import { createThreadMemory } from './lib/threadMemory';
import { ADMIN_VIEW_ID, AuthContext, SelectionContext } from './state';
import AuthScreen from './components/AuthScreen';
import JoinScreen from './components/JoinScreen';
import NativeSignIn from './components/NativeSignIn';
import WorkspaceChooser from './components/WorkspaceChooser';
import Main from './components/Main';

const ACTIVE_WS_KEY = 'flow.activeWorkspace';
const ADMIN_PANEL_KEY = 'flow.adminPanelOpen';
export const PENDING_INVITE_KEY = 'flow.pendingInvite';

/** Pull ?signup= / ?reset= / ?signin= (emailed links) and ?native= (the native
 * Google handoff, phase16 §9) off the URL before rendering. */
function consumeEmailLinkParams(): {
  signupToken: string | null;
  resetToken: string | null;
  signinToken: string | null;
  nativeHandoff: boolean;
} {
  // /invite/<token> (emailed invite link): stash in localStorage so it
  // survives the full register→confirm-email→sign-in round trip, then accept
  // automatically once a user is signed in (effect in App).
  const invite = location.pathname.match(/^\/invite\/([A-Za-z0-9_-]+)$/);
  if (invite) {
    localStorage.setItem(PENDING_INVITE_KEY, invite[1]!);
    history.replaceState(null, '', '/');
  }
  // /join/<workspace-slug>/<token> (issue #85): the persistent join link. Same
  // stash trick as the emailed invite — it has to survive the sign-in round
  // trip — but the token drives a real join page rather than being redeemed
  // in the background. The slug is decoration for the human reading the URL;
  // the token is what the server matches on.
  const joinToken = parseJoinPath(location.pathname);
  if (joinToken) {
    stashJoinToken(joinToken);
    history.replaceState(null, '', '/');
  }
  const params = new URLSearchParams(location.search);
  const signupToken = params.get('signup');
  const resetToken = params.get('reset');
  const signinToken = params.get('signin');
  // Kept in the URL, unlike the one-shot tokens: a reload of the handoff page
  // should still be the handoff page, not the ordinary app.
  const nativeHandoff = params.get('native') === 'google';
  if (signupToken || resetToken || signinToken) {
    history.replaceState(null, '', location.pathname);
  }
  return { signupToken, resetToken, signinToken, nativeHandoff };
}

export default function App() {
  const qc = useQueryClient();
  const [user, setUser] = useState<UserDTO | null>(null);
  const [booting, setBooting] = useState(true);
  const [{ signupToken, resetToken, signinToken, nativeHandoff }] = useState(consumeEmailLinkParams);
  // Active workspace survives reloads/restarts (phase 3.5 fixes).
  const [workspaceId, setWorkspaceId] = useState<string | null>(
    () => localStorage.getItem(ACTIVE_WS_KEY),
  );
  // Transient one-line banner (currently only the Google domain auto-join).
  const [notice, setNotice] = useState<string | null>(null);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [artifactId, setArtifactId] = useState<string | null>(null);
  const [threadRootId, setThreadRootId] = useState<string | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [focusMessageId, setFocusMessageId] = useState<string | null>(null);
  // Which thread each channel had open, so switching away and back restores it
  // (issue #89). In state for a stable identity across renders only — it's
  // mutable and never renders anything by itself; `threadRootId` still does.
  const [threadMemory] = useState(createThreadMemory);
  // Admin panel pinned into the sidebar (per-device, admins only at render).
  const [adminPanelOpen, setAdminPanelOpen] = useState<boolean>(
    () => localStorage.getItem(ADMIN_PANEL_KEY) === '1',
  );

  useEffect(() => {
    (async () => {
      if (!getToken()) {
        setBooting(false);
        return;
      }
      try {
        setUser(await api<UserDTO>('GET', '/v1/me'));
      } catch {
        setToken(null);
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  // Accept a stashed emailed invite as soon as we have a signed-in user
  // (fresh registration or existing account alike), then land in that
  // workspace. Any failure (expired/used/bad token) burns the stash — the
  // invite modal's link remains the manual fallback.
  useEffect(() => {
    if (!user) return;
    const token = localStorage.getItem(PENDING_INVITE_KEY);
    if (!token) return;
    void (async () => {
      try {
        const ws = await api<WorkspaceDTO>('POST', '/v1/invites/accept', { token });
        localStorage.setItem(ACTIVE_WS_KEY, ws.id);
        setWorkspaceId(ws.id);
        await qc.invalidateQueries({ queryKey: ['workspaces'] });
      } catch (err) {
        console.warn(`invite accept failed: ${(err as Error).message}`);
      } finally {
        localStorage.removeItem(PENDING_INVITE_KEY);
      }
    })();
  }, [user, qc]);

  // A stashed join link (issue #85) takes over the whole screen until it's
  // resolved — see JoinScreen. Read once at boot so the token is picked up
  // both on the first visit and on the way back from a confirmation email.
  const [pendingJoin, setPendingJoin] = useState<string | null>(readJoinToken);
  const resolveJoin = useCallback(() => {
    clearJoinToken();
    setPendingJoin(null);
  }, []);

  // Google sign-in can enroll the user into workspaces that opened their doors
  // to their email domain (phase16 §4). Land them in one instead of the empty
  // create-workspace screen, and say what happened — nobody expects to arrive
  // already a member. A pending invite still wins: its effect runs after this.
  const signIn = useCallback((resp: AuthResponse & { autoJoined?: WorkspaceDTO[] }) => {
    setToken(resp.token);
    setUser(resp.user);
    const joined = resp.autoJoined ?? [];
    if (joined.length > 0) {
      const first = joined[0]!;
      localStorage.setItem(ACTIVE_WS_KEY, first.id);
      setWorkspaceId(first.id);
      setNotice(
        joined.length === 1
          ? `You've joined ${first.name} — everyone on your email domain is welcome there.`
          : `You've joined ${joined.length} workspaces on your email domain.`,
      );
    }
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 8000);
    return () => clearTimeout(t);
  }, [notice]);

  const signOut = useCallback(() => {
    void api('POST', '/v1/auth/logout').catch(() => {});
    setToken(null);
    setUser(null);
    setWorkspaceId(null);
    setChannelId(null);
    setArtifactId(null);
    setThreadRootId(null);
    threadMemory.clear();
    setAdminPanelOpen(false);
    localStorage.removeItem(ADMIN_PANEL_KEY);
    qc.clear();
  }, [qc, threadMemory]);

  if (booting) {
    return <div className="flex h-full items-center justify-center text-faint">Loading…</div>;
  }

  // The native apps' Google button lands here (phase16 §9): sign in, mint a
  // one-time code, bounce back to flow://signin. Deliberately checked before
  // the signed-in branch — arriving with a live web session just skips ahead
  // to the handoff rather than dropping into the workspace.
  if (nativeHandoff) {
    return <NativeSignIn signedIn={!!user} />;
  }

  // A join link owns the screen until it's joined, declined, or found dead —
  // signed out it wraps the auth card so that names the workspace too.
  if (pendingJoin) {
    return (
      <JoinScreen
        token={pendingJoin}
        user={user}
        onSignedIn={signIn}
        signupToken={signupToken}
        resetToken={resetToken}
        signinToken={signinToken}
        onJoined={(ws, alreadyMember) => {
          localStorage.setItem(ACTIVE_WS_KEY, ws.id);
          setWorkspaceId(ws.id);
          setNotice(alreadyMember ? `You're already in ${ws.name}.` : `You've joined ${ws.name}.`);
          resolveJoin();
        }}
        onDismiss={resolveJoin}
      />
    );
  }

  if (!user) {
    return (
      <AuthScreen
        onSignedIn={signIn}
        signupToken={signupToken}
        resetToken={resetToken}
        signinToken={signinToken}
      />
    );
  }

  return (
    <AuthContext.Provider value={{ user, setUser, signOut }}>
      <SelectionContext.Provider
        value={{
          workspaceId,
          channelId,
          artifactId,
          threadRootId,
          editingMessageId,
          focusMessageId,
          adminPanelOpen,
          selectWorkspace: (id) => {
            setWorkspaceId(id);
            if (id) localStorage.setItem(ACTIVE_WS_KEY, id);
            else localStorage.removeItem(ACTIVE_WS_KEY);
            threadMemory.clear();
            setChannelId(null);
            setArtifactId(null);
            setThreadRootId(null);
            setEditingMessageId(null);
            setFocusMessageId(null);
          },
          // Switching channels parks the open thread rather than closing it: the
          // channel we're leaving remembers it, and the one we're entering gets
          // whatever it had open (issue #89).
          selectChannel: (id) => {
            // Deselecting entirely only happens when the active channel goes
            // away (left or archived) — there's nothing to come back to, so
            // drop its thread instead of parking it.
            if (id === null) threadMemory.remember(channelId, null);
            else threadMemory.remember(channelId, threadRootId);
            setChannelId(id);
            setArtifactId(null);
            setThreadRootId(threadMemory.recall(id));
            setEditingMessageId(null);
            setFocusMessageId(null);
          },
          // Open/activate an artifact tab in the side panel. The thread tab (if
          // any) stays open — they're tabs in the same panel (phase 13).
          selectArtifact: (id) => {
            setArtifactId(id);
            setEditingMessageId(null);
            setFocusMessageId(null);
            // select the artifact's channel so the conversation shows behind it
            if (id) {
              const cached = qc.getQueryData<{ artifacts: ArtifactDTO[] }>(['artifacts', workspaceId]);
              const a = cached?.artifacts.find((x) => x.id === id);
              // Changing channel this way still swaps the thread tab, or the
              // panel would show one channel's thread over another's messages.
              if (a && a.channelId !== channelId) {
                threadMemory.remember(channelId, threadRootId);
                setChannelId(a.channelId);
                setThreadRootId(threadMemory.recall(a.channelId));
              }
            }
          },
          // Open a thread and make its tab the visible one (artifacts stay as tabs).
          openThread: (id) => {
            setThreadRootId(id);
            threadMemory.remember(channelId, id);
            if (id) setArtifactId(null);
          },
          // Switch the side panel to the Thread tab (thread stays open).
          showThread: () => setArtifactId(null),
          // Close the whole side panel.
          closeSidePanel: () => {
            setThreadRootId(null);
            threadMemory.remember(channelId, null);
            setArtifactId(null);
          },
          setEditingMessage: setEditingMessageId,
          jumpToMessage: (toChannelId, messageId, toThreadRootId) => {
            threadMemory.remember(channelId, threadRootId);
            setArtifactId(null);
            setChannelId(toChannelId);
            // An explicit jump decides what's open in the target channel — a
            // top-level target closes whatever thread it had parked.
            setThreadRootId(toThreadRootId ?? null);
            threadMemory.remember(toChannelId, toThreadRootId ?? null);
            setEditingMessageId(null);
            setFocusMessageId(messageId);
          },
          clearFocusMessage: () => setFocusMessageId(null),
          openAdminPanel: () => {
            setAdminPanelOpen(true);
            localStorage.setItem(ADMIN_PANEL_KEY, '1');
            threadMemory.remember(channelId, threadRootId);
            setChannelId(ADMIN_VIEW_ID);
            setThreadRootId(null);
            setEditingMessageId(null);
          },
          closeAdminPanel: () => {
            setAdminPanelOpen(false);
            localStorage.removeItem(ADMIN_PANEL_KEY);
            // If it's the active view, fall back to a channel (effect picks #general).
            setChannelId((cur) => (cur === ADMIN_VIEW_ID ? null : cur));
          },
        }}
      >
        {notice && (
          <div
            data-testid="app-notice"
            className="fixed inset-x-0 top-3 z-50 mx-auto w-fit max-w-[calc(100vw-2rem)] rounded-full bg-accent px-4 py-2 text-center text-sm font-semibold text-white shadow-lg"
            onClick={() => setNotice(null)}
          >
            {notice}
          </div>
        )}
        {workspaceId ? <Main /> : <WorkspaceChooser />}
      </SelectionContext.Provider>
    </AuthContext.Provider>
  );
}
