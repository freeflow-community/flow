import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ArtifactDTO, UserDTO, AuthResponse, WorkspaceDTO } from '@flow/shared';
import {
  activeRuntime,
  connectionManager,
  type ApiError,
  type ConnectionRuntime,
} from './lib/connectionRuntime';
import { clearJoinToken, parseJoinPath, readJoinToken, stashJoinToken } from './lib/joinLink';
import { createThreadMemory } from './lib/threadMemory';
import {
  backTarget,
  canGoBack,
  canGoForward,
  emptyNavHistory,
  forgetNav,
  forwardTarget,
  pushNav,
  stepNav,
  type NavHistory,
} from './lib/navHistory';
import { ADMIN_VIEW_ID, AuthContext, ConnectionContext, SelectionContext } from './state';
import AuthScreen from './components/AuthScreen';
import JoinScreen from './components/JoinScreen';
import NativeSignIn from './components/NativeSignIn';
import WorkspaceChooser from './components/WorkspaceChooser';
import Main from './components/Main';

// Names, not keys. Every one of these is per connection+identity: the runtime
// turns a name into the storage key its session owns, and the connection the
// pre-multi-server browser was already using resolves them to exactly the
// `flow.*` keys it already has (see lib/connections.ts).
const ACTIVE_WS = 'activeWorkspace';
const ADMIN_PANEL = 'adminPanelOpen';
export const PENDING_INVITE = 'pendingInvite';

/** Pull ?signup= / ?reset= / ?signin= (emailed links) and ?native= (the native
 * Google handoff, phase16 §9) off the URL before rendering. */
function consumeEmailLinkParams(runtime: ConnectionRuntime): {
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
    runtime.write(PENDING_INVITE, invite[1]!);
    history.replaceState(null, '', '/');
  }
  // /join/<workspace-slug>/<token> (issue #85): the persistent join link. Same
  // stash trick as the emailed invite — it has to survive the sign-in round
  // trip — but the token drives a real join page rather than being redeemed
  // in the background. The slug is decoration for the human reading the URL;
  // the token is what the server matches on.
  const joinToken = parseJoinPath(location.pathname);
  if (joinToken) {
    stashJoinToken(joinToken, Date.now(), runtime.key('pendingJoinLink'));
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
  // The connection this window is pointed at. One today (the migrated default);
  // the manager is what phase 3's switcher will drive.
  const [runtime] = useState(activeRuntime);
  const [user, setUser] = useState<UserDTO | null>(null);
  const [booting, setBooting] = useState(true);
  const [{ signupToken, resetToken, signinToken, nativeHandoff }] = useState(() =>
    consumeEmailLinkParams(runtime),
  );
  // Active workspace survives reloads/restarts (phase 3.5 fixes), per session.
  const [workspaceId, setWorkspaceId] = useState<string | null>(
    () => runtime.read(ACTIVE_WS),
  );
  // Replacing this connection's bearer bumps its auth generation, so a 401
  // from a request that went out under the previous one is ignored rather than
  // invalidating the session that replaced it.
  const replaceToken = useCallback(
    (token: string | null) => {
      connectionManager().noteTokenReplaced(runtime.connectionId, runtime.setToken(token));
    },
    [runtime],
  );

  // Transient one-line banner (currently only the Google domain auto-join).
  const [notice, setNotice] = useState<string | null>(null);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [artifactId, setArtifactId] = useState<string | null>(null);
  const [filesOpen, setFilesOpen] = useState(false);
  const [threadRootId, setThreadRootId] = useState<string | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [focusMessageId, setFocusMessageId] = useState<string | null>(null);
  // Which thread each channel had open, so switching away and back restores it
  // (issue #89). In state for a stable identity across renders only — it's
  // mutable and never renders anything by itself; `threadRootId` still does.
  const [threadMemory] = useState(createThreadMemory);
  // Browser-style visit history over the main pane (issue #386) — what the
  // header's back/forward buttons walk. Per-session and per-workspace.
  const [nav, setNav] = useState<NavHistory>(emptyNavHistory);
  // Admin panel pinned into the sidebar (per-device, admins only at render).
  const [adminPanelOpen, setAdminPanelOpen] = useState<boolean>(
    () => runtime.read(ADMIN_PANEL) === '1',
  );

  // A 401 on a *current-generation* request means this connection's session is
  // gone server-side. Recorded against the connection rather than acted on: the
  // single-connection experience is unchanged by this ticket, and phase 3's
  // connection list is what surfaces it.
  useEffect(() => {
    runtime.setUnauthorizedHandler(() => connectionManager().markUnauthorized(runtime.connectionId));
    return () => runtime.setUnauthorizedHandler(null);
  }, [runtime]);

  // Boot this connection's session: the adopted token is only believed once
  // /v1/me answers, and only then is the identity committed to the registry —
  // which is what decides whether the cached state under this namespace is
  // still ours or has to be discarded and refetched.
  useEffect(() => {
    (async () => {
      if (!runtime.getToken()) {
        setBooting(false);
        return;
      }
      try {
        const me = await runtime.api<UserDTO>('GET', '/v1/me');
        connectionManager().bindIdentity(runtime.connectionId, me.id);
        setUser(me);
      } catch (err) {
        // Only a *rejected* token is dropped. An unreachable server leaves the
        // session alone: an upgraded client that boots offline must not lose it.
        if ((err as ApiError).status === 401) {
          replaceToken(null);
          connectionManager().markSignedOut(runtime.connectionId);
        }
      } finally {
        setBooting(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime]);

  // Warm the blob cache with our own avatar so the first message we send
  // this session doesn't flash the placeholder while it loads.
  useEffect(() => {
    if (user?.avatarUrl) void runtime.blobUrl(user.avatarUrl).catch(() => {});
  }, [runtime, user?.avatarUrl]);

  // Accept a stashed emailed invite as soon as we have a signed-in user
  // (fresh registration or existing account alike), then land in that
  // workspace. Any failure (expired/used/bad token) burns the stash — the
  // invite modal's link remains the manual fallback.
  useEffect(() => {
    if (!user) return;
    const token = runtime.read(PENDING_INVITE);
    if (!token) return;
    void (async () => {
      try {
        const ws = await runtime.api<WorkspaceDTO>('POST', '/v1/invites/accept', { token });
        runtime.write(ACTIVE_WS, ws.id);
        setWorkspaceId(ws.id);
        await qc.invalidateQueries({ queryKey: ['workspaces'] });
      } catch (err) {
        console.warn(`invite accept failed: ${(err as Error).message}`);
      } finally {
        runtime.write(PENDING_INVITE, null);
      }
    })();
  }, [runtime, user, qc]);

  // A stashed join link (issue #85) takes over the whole screen until it's
  // resolved — see JoinScreen. Read once at boot so the token is picked up
  // both on the first visit and on the way back from a confirmation email.
  const [pendingJoin, setPendingJoin] = useState<string | null>(() =>
    readJoinToken(Date.now(), runtime.key('pendingJoinLink')),
  );
  const resolveJoin = useCallback(() => {
    clearJoinToken(runtime.key('pendingJoinLink'));
    setPendingJoin(null);
  }, [runtime]);

  // Google sign-in can enroll the user into workspaces that opened their doors
  // to their email domain (phase16 §4). Land them in one instead of the empty
  // create-workspace screen, and say what happened — nobody expects to arrive
  // already a member. A pending invite still wins: its effect runs after this.
  const signIn = useCallback((resp: AuthResponse & { autoJoined?: WorkspaceDTO[] }) => {
    replaceToken(resp.token);
    // The server issued this session, so the identity is verified: commit it.
    // A different user on this connection rotates the namespace, so the
    // previous one's cached state is dropped rather than inherited.
    connectionManager().bindIdentity(runtime.connectionId, resp.user.id);
    setUser(resp.user);
    const joined = resp.autoJoined ?? [];
    if (joined.length > 0) {
      const first = joined[0]!;
      runtime.write(ACTIVE_WS, first.id);
      setWorkspaceId(first.id);
      setNotice(
        joined.length === 1
          ? `You've joined ${first.name} — everyone on your email domain is welcome there.`
          : `You've joined ${joined.length} workspaces on your email domain.`,
      );
    }
  }, [replaceToken, runtime]);

  // Where this connection+identity is parked, so a NavigationTarget survives
  // restart per session rather than as one global "last channel".
  useEffect(() => {
    if (!user || !workspaceId) return;
    connectionManager().rememberNavigation({
      connectionId: runtime.connectionId,
      userId: user.id,
      workspaceId,
      ...(channelId ? { channelId } : {}),
      ...(threadRootId ? { threadRootId } : {}),
      ...(artifactId ? { artifactId } : {}),
    });
  }, [runtime, user, workspaceId, channelId, threadRootId, artifactId]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 8000);
    return () => clearTimeout(t);
  }, [notice]);

  // Sign out of *this* connection only: its bearer, its caches and object URLs,
  // its query cache, its stored selection. Any other connection's runtime is
  // untouched, and a late response on this one cannot recreate what went.
  const signOut = useCallback(() => {
    void runtime.api('POST', '/v1/auth/logout').catch(() => {});
    replaceToken(null);
    connectionManager().markSignedOut(runtime.connectionId);
    setUser(null);
    setWorkspaceId(null);
    setChannelId(null);
    setArtifactId(null);
    setThreadRootId(null);
    threadMemory.clear();
    setNav(emptyNavHistory);
    setAdminPanelOpen(false);
    runtime.write(ADMIN_PANEL, null);
    runtime.write(ACTIVE_WS, null);
    qc.clear();
  }, [qc, replaceToken, runtime, threadMemory]);

  // Switch the main pane to a view, with all the usual channel-switch
  // side-effects (park/restore the open thread, close the side panel, drop the
  // edit and scroll targets) but WITHOUT recording a visit. `selectChannel`
  // records; back/forward replay, so they must not.
  const showChannel = (id: string | null) => {
    // Deselecting entirely only happens when the active channel goes away
    // (left or archived) — there's nothing to come back to, so drop its thread
    // instead of parking it.
    threadMemory.remember(channelId, id === null ? null : threadRootId);
    setChannelId(id);
    setArtifactId(null);
    // Files are per-channel: the tab doesn't follow you to the next one.
    setFilesOpen(false);
    setThreadRootId(threadMemory.recall(id));
    setEditingMessageId(null);
    setFocusMessageId(null);
  };

  const step = (delta: -1 | 1) => {
    const target = delta === -1 ? backTarget(nav) : forwardTarget(nav);
    if (!target) return;
    setNav((h) => stepNav(h, delta));
    showChannel(target);
  };

  if (booting) {
    return <div className="flex h-full items-center justify-center text-faint">Loading…</div>;
  }

  // The native apps' Google button lands here (phase16 §9): sign in, mint a
  // one-time code, bounce back to flow://signin. Deliberately checked before
  // the signed-in branch — arriving with a live web session offers that
  // account for the handoff rather than dropping into the workspace.
  if (nativeHandoff) {
    return <NativeSignIn user={user} />;
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
          runtime.write(ACTIVE_WS, ws.id);
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
    <ConnectionContext.Provider value={runtime}>
    <AuthContext.Provider value={{ user, setUser, signOut }}>
      <SelectionContext.Provider
        value={{
          workspaceId,
          channelId,
          artifactId,
          filesOpen,
          threadRootId,
          editingMessageId,
          focusMessageId,
          adminPanelOpen,
          canGoBack: canGoBack(nav),
          canGoForward: canGoForward(nav),
          goBack: () => step(-1),
          goForward: () => step(1),
          selectWorkspace: (id) => {
            setWorkspaceId(id);
            runtime.write(ACTIVE_WS, id);
            threadMemory.clear();
            // The other workspace's channels aren't reachable from here.
            setNav(emptyNavHistory);
            setChannelId(null);
            setArtifactId(null);
            setFilesOpen(false);
            setThreadRootId(null);
            setEditingMessageId(null);
            setFocusMessageId(null);
          },
          // Switching channels parks the open thread rather than closing it: the
          // channel we're leaving remembers it, and the one we're entering gets
          // whatever it had open (issue #89).
          selectChannel: (id) => {
            showChannel(id);
            // A deselection means the channel is gone (left or archived), so it
            // leaves the history too rather than becoming a dead back target.
            if (id) setNav((h) => pushNav(h, id));
            else if (channelId) setNav((h) => forgetNav(h, channelId));
          },
          // Open/activate an artifact tab in the side panel. The thread tab (if
          // any) stays open — they're tabs in the same panel (phase 13).
          selectArtifact: (id) => {
            setArtifactId(id);
            if (id) setFilesOpen(false);
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
                setNav((h) => pushNav(h, a.channelId));
              }
            }
          },
          // Channel + artifact in one action (#394). Same park-and-restore as an
          // ordinary channel switch; the artifact id is given rather than looked
          // up, because an app opened from the Apps section can live in a channel
          // that only just became visible to this client.
          openArtifactIn: (chanId, id) => {
            if (chanId !== channelId) {
              threadMemory.remember(channelId, threadRootId);
              setChannelId(chanId);
              setThreadRootId(threadMemory.recall(chanId));
            }
            setArtifactId(id);
            setFilesOpen(false);
            setEditingMessageId(null);
            setFocusMessageId(null);
          },
          // Open a thread and make its tab the visible one (artifacts stay as tabs).
          openThread: (id) => {
            setThreadRootId(id);
            threadMemory.remember(channelId, id);
            if (id) {
              setArtifactId(null);
              setFilesOpen(false);
            }
          },
          // The Files tab (#347) takes the panel the way an artifact tab does.
          openFiles: (open) => {
            setFilesOpen(open);
            if (open) setArtifactId(null);
          },
          // Switch the side panel to the Thread tab (thread stays open).
          showThread: () => {
            setArtifactId(null);
            setFilesOpen(false);
          },
          // Close the whole side panel.
          closeSidePanel: () => {
            setThreadRootId(null);
            threadMemory.remember(channelId, null);
            setArtifactId(null);
            setFilesOpen(false);
          },
          setEditingMessage: setEditingMessageId,
          jumpToMessage: (toChannelId, messageId, toThreadRootId) => {
            threadMemory.remember(channelId, threadRootId);
            setArtifactId(null);
            setFilesOpen(false);
            setChannelId(toChannelId);
            // An explicit jump decides what's open in the target channel — a
            // top-level target closes whatever thread it had parked.
            setThreadRootId(toThreadRootId ?? null);
            threadMemory.remember(toChannelId, toThreadRootId ?? null);
            setEditingMessageId(null);
            setFocusMessageId(messageId);
            setNav((h) => pushNav(h, toChannelId));
          },
          clearFocusMessage: () => setFocusMessageId(null),
          openAdminPanel: () => {
            setAdminPanelOpen(true);
            runtime.write(ADMIN_PANEL, '1');
            threadMemory.remember(channelId, threadRootId);
            setChannelId(ADMIN_VIEW_ID);
            setThreadRootId(null);
            setEditingMessageId(null);
            setNav((h) => pushNav(h, ADMIN_VIEW_ID));
          },
          closeAdminPanel: () => {
            setAdminPanelOpen(false);
            runtime.write(ADMIN_PANEL, null);
            // If it's the active view, fall back to a channel (effect picks #general).
            setChannelId((cur) => (cur === ADMIN_VIEW_ID ? null : cur));
            // Unpinned: back must not walk into a panel that is no longer there.
            setNav((h) => forgetNav(h, ADMIN_VIEW_ID));
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
    </ConnectionContext.Provider>
  );
}
