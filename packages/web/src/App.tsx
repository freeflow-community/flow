import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { UserDTO, AuthResponse } from '@mychat/shared';
import { api, getToken, setToken } from './lib/api';
import { AuthContext, SelectionContext } from './state';
import AuthScreen from './components/AuthScreen';
import WorkspaceChooser from './components/WorkspaceChooser';
import Main from './components/Main';

const ACTIVE_WS_KEY = 'mychat.activeWorkspace';

export default function App() {
  const qc = useQueryClient();
  const [user, setUser] = useState<UserDTO | null>(null);
  const [booting, setBooting] = useState(true);
  // Active workspace survives reloads/restarts (phase 3.5 fixes).
  const [workspaceId, setWorkspaceId] = useState<string | null>(
    () => localStorage.getItem(ACTIVE_WS_KEY),
  );
  const [channelId, setChannelId] = useState<string | null>(null);
  const [threadRootId, setThreadRootId] = useState<string | null>(null);

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
    return <AuthScreen onSignedIn={signIn} />;
  }

  return (
    <AuthContext.Provider value={{ user, setUser, signOut }}>
      <SelectionContext.Provider
        value={{
          workspaceId,
          channelId,
          threadRootId,
          selectWorkspace: (id) => {
            setWorkspaceId(id);
            if (id) localStorage.setItem(ACTIVE_WS_KEY, id);
            else localStorage.removeItem(ACTIVE_WS_KEY);
            setChannelId(null);
            setThreadRootId(null);
          },
          selectChannel: (id) => {
            setChannelId(id);
            setThreadRootId(null);
          },
          openThread: setThreadRootId,
        }}
      >
        {workspaceId ? <Main /> : <WorkspaceChooser />}
      </SelectionContext.Provider>
    </AuthContext.Provider>
  );
}
