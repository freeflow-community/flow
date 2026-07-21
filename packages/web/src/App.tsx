import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { UserDTO, AuthResponse, WorkspaceDTO } from '@flow/shared';
import { api, getToken, setToken } from './lib/api';
import { AuthContext, SelectionContext } from './state';
import AuthScreen from './components/AuthScreen';
import WorkspaceChooser from './components/WorkspaceChooser';
import Main from './components/Main';

const ACTIVE_WS_KEY = 'flow.activeWorkspace';
export const PENDING_INVITE_KEY = 'flow.pendingInvite';

/** Pull ?signup= / ?reset= / ?signin= (emailed links) off the URL before rendering. */
function consumeEmailLinkParams(): {
  signupToken: string | null;
  resetToken: string | null;
  signinToken: string | null;
} {
  // /invite/<token> (emailed invite link): stash in localStorage so it
  // survives the full register→confirm-email→sign-in round trip, then accept
  // automatically once a user is signed in (effect in App).
  const invite = location.pathname.match(/^\/invite\/([A-Za-z0-9_-]+)$/);
  if (invite) {
    localStorage.setItem(PENDING_INVITE_KEY, invite[1]!);
    history.replaceState(null, '', '/');
  }
  const params = new URLSearchParams(location.search);
  const signupToken = params.get('signup');
  const resetToken = params.get('reset');
  const signinToken = params.get('signin');
  if (signupToken || resetToken || signinToken) {
    history.replaceState(null, '', location.pathname);
  }
  return { signupToken, resetToken, signinToken };
}

export default function App() {
  const qc = useQueryClient();
  const [user, setUser] = useState<UserDTO | null>(null);
  const [booting, setBooting] = useState(true);
  const [{ signupToken, resetToken, signinToken }] = useState(consumeEmailLinkParams);
  // Active workspace survives reloads/restarts (phase 3.5 fixes).
  const [workspaceId, setWorkspaceId] = useState<string | null>(
    () => localStorage.getItem(ACTIVE_WS_KEY),
  );
  const [channelId, setChannelId] = useState<string | null>(null);
  const [threadRootId, setThreadRootId] = useState<string | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);

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

  const signIn = useCallback((resp: AuthResponse) => {
    setToken(resp.token);
    setUser(resp.user);
  }, []);

  const signOut = useCallback(() => {
    void api('POST', '/v1/auth/logout').catch(() => {});
    setToken(null);
    setUser(null);
    setWorkspaceId(null);
    setChannelId(null);
    setThreadRootId(null);
    qc.clear();
  }, [qc]);

  if (booting) {
    return <div className="flex h-full items-center justify-center text-faint">Loading…</div>;
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
          threadRootId,
          editingMessageId,
          selectWorkspace: (id) => {
            setWorkspaceId(id);
            if (id) localStorage.setItem(ACTIVE_WS_KEY, id);
            else localStorage.removeItem(ACTIVE_WS_KEY);
            setChannelId(null);
            setThreadRootId(null);
            setEditingMessageId(null);
          },
          selectChannel: (id) => {
            setChannelId(id);
            setThreadRootId(null);
            setEditingMessageId(null);
          },
          openThread: setThreadRootId,
          setEditingMessage: setEditingMessageId,
        }}
      >
        {workspaceId ? <Main /> : <WorkspaceChooser />}
      </SelectionContext.Provider>
    </AuthContext.Provider>
  );
}
