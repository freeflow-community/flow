import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { sidebarColor } from '@flow/shared';
import type { Event, NotificationDTO, TypingData, PresenceData } from '@flow/shared';
import { getToken } from '../lib/api';
import { SocketClient, type SocketStatus } from '../lib/ws';
import { plainBody } from '../lib/format';
import { LiveContext, useAuth, useSelection } from '../state';
import { useNameMap, useWorkspaces } from '../hooks';
import Sidebar from './Sidebar';
import ChannelView from './ChannelView';
import ThreadPanel from './ThreadPanel';
import { OpenInAppBanner } from './OpenInApp';
import NotificationsBell from './NotificationsBell';

export default function Main() {
  const auth = useAuth();
  const sel = useSelection();
  const qc = useQueryClient();
  const [status, setStatus] = useState<SocketStatus>('connecting');
  const [presence, setPresence] = useState<Record<string, boolean>>({});
  const [typing, setTyping] = useState<Record<string, Record<string, number>>>({});
  const [notificationUnread, setNotificationUnread] = useState(0);
  const socketRef = useRef<SocketClient | null>(null);
  // refs so the socket handler always sees current selection
  const selRef = useRef(sel);
  selRef.current = sel;
  const names = useNameMap(sel.workspaceId);
  const namesRef = useRef(names);
  namesRef.current = names;

  useEffect(() => {
    // initial unread count + browser notification permission
    void (async () => {
      try {
        const r = await fetch('/v1/me/notifications?limit=1', {
          headers: { authorization: `Bearer ${getToken() ?? ''}` },
        });
        const j = (await r.json()) as { unreadCount?: number };
        setNotificationUnread(j.unreadCount ?? 0);
      } catch {
        /* offline */
      }
    })();
    if ('Notification' in window && Notification.permission === 'default') {
      void Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    const client = new SocketClient(token, {
      onStatus: (s) => {
        setStatus(s);
        if (s === 'connected') {
          // reconnect backfill = refetch everything (online-only client)
          void qc.invalidateQueries();
        }
      },
      onEvent: (event: Event) => handleEvent(event),
    });
    socketRef.current = client;
    client.start();
    return () => {
      client.stop();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleEvent(event: Event): void {
    const cur = selRef.current;
    switch (event.type) {
      case 'message.created':
      case 'message.updated':
      case 'message.deleted':
      case 'thread.reply': {
        const data = event.data as { channelId: string; threadRootId: string | null };
        void qc.invalidateQueries({ queryKey: ['messages', data.channelId] });
        if (data.threadRootId) void qc.invalidateQueries({ queryKey: ['thread', data.threadRootId] });
        void qc.invalidateQueries({ queryKey: ['channels', event.workspaceId] });
        break;
      }
      case 'reaction.added':
      case 'reaction.removed': {
        const data = event.data as { channelId: string };
        void qc.invalidateQueries({ queryKey: ['messages', data.channelId] });
        void qc.invalidateQueries({ queryKey: ['thread'] });
        break;
      }
      case 'typing': {
        const t = event.data as TypingData;
        if (t.userId === auth.user.id) break;
        setTyping((prev) => ({
          ...prev,
          [t.channelId]: { ...(prev[t.channelId] ?? {}), [t.userId]: Date.now() },
        }));
        break;
      }
      case 'presence': {
        const p = event.data as PresenceData;
        setPresence((prev) => ({ ...prev, [p.userId]: p.status === 'online' }));
        break;
      }
      case 'channel.created':
      case 'channel.archived':
      case 'member.joined':
      case 'member.left':
        void qc.invalidateQueries({ queryKey: ['channels', event.workspaceId] });
        void qc.invalidateQueries({ queryKey: ['members', event.workspaceId] });
        break;
      case 'user.updated':
        void qc.invalidateQueries({ queryKey: ['members'] });
        void qc.invalidateQueries({ queryKey: ['me'] });
        break;
      case 'workspace.updated':
        void qc.invalidateQueries({ queryKey: ['workspaces'] });
        break;
      case 'notification.created': {
        const n = event.data as NotificationDTO;
        void qc.invalidateQueries({ queryKey: ['notifications'] });
        if (n.channelId !== cur.channelId || document.hidden) {
          setNotificationUnread((v) => v + 1);
          maybeBanner(n);
        }
        break;
      }
      default:
        break;
    }
  }

  function maybeBanner(n: NotificationDTO): void {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if (!document.hidden && n.channelId === selRef.current.channelId) return;
    const sender = namesRef.current[n.message.userId] ?? 'Someone';
    const title =
      n.kind === 1 ? `${sender} (DM)` : n.kind === 2 ? `${sender} replied in a thread` : `${sender} mentioned you`;
    try {
      new Notification(title, { body: plainBody(n.message.body, namesRef.current), tag: n.id });
    } catch {
      /* banner is best-effort */
    }
  }

  const live = useMemo(
    () => ({
      status,
      presence,
      typing,
      notificationUnread,
      setNotificationUnread,
      sendTyping: (channelId: string) => socketRef.current?.sendTyping(channelId),
    }),
    [status, presence, typing, notificationUnread],
  );

  return (
    <LiveContext.Provider value={live}>
      <div className="flex h-full flex-col bg-base text-ink">
        <OpenInAppBanner />
        <div className="flex min-h-0 flex-1">
          <WorkspaceRail />
          <Sidebar />
          <div className="flex min-h-0 min-w-0 flex-1">
            {sel.channelId ? (
              <>
                <ChannelView key={sel.channelId} channelId={sel.channelId} />
                {sel.threadRootId && (
                  <ThreadPanel key={sel.threadRootId} rootId={sel.threadRootId} />
                )}
              </>
            ) : (
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex h-[60px] items-center justify-end border-b border-hairline px-[22px]">
                  <NotificationsBell />
                </div>
                <div className="flex flex-1 items-center justify-center text-faint">
                  Select a channel
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </LiveContext.Provider>
  );
}

/** Design 3a column 1: the 64px violet workspace rail. */
function WorkspaceRail() {
  const sel = useSelection();
  const workspaces = useWorkspaces();
  const activeWs = (workspaces.data ?? []).find((w) => w.id === sel.workspaceId);
  return (
    <nav
      className="flex w-16 shrink-0 flex-col items-center gap-3.5 py-4"
      style={{ background: sidebarColor(activeWs?.sidebarColor).rail }}
    >
      {(workspaces.data ?? []).map((w) => {
        const active = w.id === sel.workspaceId;
        return (
          <button
            key={w.id}
            data-testid={`rail-workspace-${w.slug}`}
            title={w.name}
            className={`flex h-10 w-10 items-center justify-center rounded-xl ${
              active
                ? 'bg-white text-[17px] font-extrabold text-accent'
                : 'bg-white/15 text-sm font-bold text-white hover:bg-white/25'
            }`}
            onClick={() => { if (!active) sel.selectWorkspace(w.id); }}
          >
            {w.name.slice(0, 1).toUpperCase()}
          </button>
        );
      })}
      <button
        data-testid="rail-add-workspace"
        title="Add a workspace"
        className="flex h-10 w-10 items-center justify-center rounded-xl border border-dashed border-white/40 text-white/70 hover:border-white/70 hover:text-white"
        onClick={() => sel.selectWorkspace(null)}
      >
        +
      </button>
    </nav>
  );
}
