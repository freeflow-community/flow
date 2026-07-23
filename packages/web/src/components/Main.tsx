import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { sidebarColor } from '@flow/shared';
import type { ArtifactDTO, Event, MessageDTO, NotificationDTO, TypingData, PresenceData } from '@flow/shared';
import { applyMessageEvent, removeMessageFromCache } from '../lib/messageCache';
import { api, getToken } from '../lib/api';
import { SocketClient, type SocketStatus } from '../lib/ws';
import { plainBody } from '../lib/format';
import { ACTIVITY_VIEW_ID, ADMIN_VIEW_ID, LiveContext, MobileNavContext, typingKey, useAuth, useSelection } from '../state';
import { useNameMap, useWorkspaces } from '../hooks';
import Sidebar from './Sidebar';
import ChannelView from './ChannelView';
import AdminView from './AdminView';
import ActivityView from './ActivityView';
import SidePanel from './SidePanel';
import { OpenInAppBanner } from './OpenInApp';
import { MobileMenuButton } from './MobileMenuButton';
import AgentPairingPrompt from './AgentPairingPrompt';

export default function Main() {
  const auth = useAuth();
  const sel = useSelection();
  const qc = useQueryClient();
  const [status, setStatus] = useState<SocketStatus>('connecting');
  const [presence, setPresence] = useState<Record<string, boolean>>({});
  const [typing, setTyping] = useState<Record<string, Record<string, number>>>({});
  const [notificationUnread, setNotificationUnread] = useState(0);
  // Responsive layout: below `md` the rail+sidebar collapse into a slide-in
  // drawer over a full-width content pane (see the layout JSX below).
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches,
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const socketRef = useRef<SocketClient | null>(null);
  // refs so the socket handler always sees current selection
  const selRef = useRef(sel);
  selRef.current = sel;
  const authRef = useRef(auth);
  authRef.current = auth;
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

  // Track the mobile breakpoint; leaving mobile always dismisses the drawer.
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const onChange = () => {
      setIsMobile(mq.matches);
      if (!mq.matches) setDrawerOpen(false);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // On mobile, picking a channel/artifact from the drawer closes it so the
  // conversation takes the full screen. (Covers every selection path at once.)
  useEffect(() => {
    setDrawerOpen(false);
  }, [sel.channelId, sel.artifactId]);

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

  function clearTyping(key: string, userId: string): void {
    setTyping((prev) => {
      const chan = prev[key];
      if (!chan || !(userId in chan)) return prev;
      const { [userId]: _gone, ...rest } = chan;
      return { ...prev, [key]: rest };
    });
  }

  function handleEvent(event: Event): void {
    const cur = selRef.current;
    switch (event.type) {
      case 'message.purged': {
        // Hard delete: remove the message entirely (no tombstone). Used for
        // the agent's ephemeral "thinking…" status.
        removeMessageFromCache(qc, event.data as MessageDTO);
        void qc.invalidateQueries({ queryKey: ['channels', event.workspaceId] });
        break;
      }
      case 'message.created':
      case 'message.updated':
      case 'message.deleted':
      case 'thread.reply': {
        // Events carry the full MessageDTO: apply it to the cache directly
        // (local-first; no refetch of the whole list per incoming message).
        const msg = event.data as MessageDTO;
        if (event.type === 'message.created' || event.type === 'thread.reply') {
          // The sender's message arrived — drop their lingering typing entry
          // for the composer they sent it from (main view or that thread).
          clearTyping(typingKey(msg.channelId, msg.threadRootId), msg.userId);
        }
        const insert = event.type === 'message.created' || event.type === 'thread.reply';
        applyMessageEvent(qc, msg, insert);
        // Sidebar unread counts/ordering still come from the channels query.
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
        // Scoped to the composer it came from: a thread's indicator belongs to
        // that thread, not the channel's main view.
        const key = typingKey(t.channelId, t.threadRootId);
        setTyping((prev) => ({
          ...prev,
          [key]: { ...(prev[key] ?? {}), [t.userId]: Date.now() },
        }));
        // The render-time 5s filter never re-renders on its own, so a stale
        // entry would linger; sweep it once the window has passed.
        window.setTimeout(() => {
          setTyping((prev) => {
            const at = prev[key]?.[t.userId];
            if (at === undefined || Date.now() - at < 5000) return prev;
            const { [t.userId]: _gone, ...rest } = prev[key]!;
            return { ...prev, [key]: rest };
          });
        }, 5200);
        break;
      }
      case 'presence': {
        const p = event.data as PresenceData;
        setPresence((prev) => ({ ...prev, [p.userId]: p.status === 'online' }));
        break;
      }
      case 'channel.created':
      case 'channel.updated':
      case 'channel.archived':
      case 'member.joined':
      case 'member.left':
        void qc.invalidateQueries({ queryKey: ['channels', event.workspaceId] });
        void qc.invalidateQueries({ queryKey: ['members', event.workspaceId] });
        void qc.invalidateQueries({ queryKey: ['channelMembers'] });
        break;
      case 'member.updated':
        // Role change (admin panel): refresh the roster, and the workspace list
        // so the affected member's own menu gating (owner/admin) re-derives.
        void qc.invalidateQueries({ queryKey: ['members', event.workspaceId] });
        void qc.invalidateQueries({ queryKey: ['workspaces'] });
        break;
      case 'user.updated':
        void qc.invalidateQueries({ queryKey: ['members'] });
        void qc.invalidateQueries({ queryKey: ['me'] });
        break;
      case 'workspace.updated':
        void qc.invalidateQueries({ queryKey: ['workspaces'] });
        break;
      case 'agent.pairing':
        // an agent named this user as its sponsor — surface the approval prompt
        void qc.invalidateQueries({ queryKey: ['agentRequests'] });
        break;
      case 'artifact.created':
      case 'artifact.updated':
      case 'artifact.deleted': {
        // per-channel shared artifacts (phase 13): keep the sidebar list fresh;
        // a deletion of the open artifact closes the side panel
        void qc.invalidateQueries({ queryKey: ['artifacts', event.workspaceId] });
        const a = event.data as ArtifactDTO;
        if (event.type === 'artifact.deleted' && cur.artifactId === a.id) cur.selectArtifact(null);
        // Auto-open an agent-created artifact for whoever is looking at its
        // channel — the user who asked the agent to make it. Gated on ownsFile
        // (agent-generated content) so a human "Pin as artifact" never steals
        // focus, and on the active channel so it only pops for someone in that
        // conversation. Updates don't re-open (they'd yank focus mid-view).
        if (event.type === 'artifact.created' && a.ownsFile && a.channelId === cur.channelId) {
          // Seed the list cache with the DTO *before* selecting: the invalidate
          // above refetches async, and ArtifactBody self-closes if the selected
          // id isn't in the (still-stale) list — so without this the panel would
          // pop open and immediately close. The refetch reconciles a moment later.
          qc.setQueryData<{ artifacts: ArtifactDTO[] }>(['artifacts', event.workspaceId], (old) => {
            const list = old?.artifacts ?? [];
            return list.some((x) => x.id === a.id) ? old! : { artifacts: [a, ...list] };
          });
          cur.selectArtifact(a.id);
        }
        break;
      }
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
    // phase 10: the server computed the alert decision (prefs + status)
    if (n.suppressAlert) return;
    if (!document.hidden && n.channelId === selRef.current.channelId) return;
    const sender = namesRef.current[n.message.userId] ?? 'Someone';
    const title =
      n.kind === 1 ? `${sender} (DM)` : n.kind === 2 ? `${sender} replied in a thread` : `${sender} mentioned you`;
    try {
      const banner = new Notification(title, {
        body: plainBody(n.message.body, namesRef.current),
        tag: n.id,
        // presentation pref: persist until dismissed (browser permitting)
        requireInteraction: authRef.current.user.notificationPrefs.persistentBanners === true,
      });
      // Clicking the OS banner should focus this tab and jump straight to the
      // triggering message — same navigation the in-app Activity list does.
      banner.onclick = () => {
        window.focus();
        banner.close();
        const s = selRef.current;
        if (s.workspaceId !== n.workspaceId) s.selectWorkspace(n.workspaceId);
        s.jumpToMessage(n.channelId, n.messageId, n.message.threadRootId);
        void api('POST', '/v1/me/notifications/read', { upToId: n.id }).then(() =>
          qc.invalidateQueries({ queryKey: ['notifications'] }),
        );
      };
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
      sendTyping: (channelId: string, threadRootId?: string) =>
        socketRef.current?.sendTyping(channelId, threadRootId),
    }),
    [status, presence, typing, notificationUnread],
  );

  const mobileNav = useMemo(
    () => ({
      isMobile,
      drawerOpen,
      openDrawer: () => setDrawerOpen(true),
      closeDrawer: () => setDrawerOpen(false),
    }),
    [isMobile, drawerOpen],
  );

  return (
    <LiveContext.Provider value={live}>
     <MobileNavContext.Provider value={mobileNav}>
      <div className="flex h-full flex-col bg-base text-ink">
        <OpenInAppBanner />
        <AgentPairingPrompt />
        <div className="relative flex min-h-0 flex-1">
          {/* Rail + sidebar. Desktop: inline flex columns. Mobile (<md): a
              fixed slide-in drawer over the content, toggled by the header
              hamburger and dismissed by the backdrop or a selection. */}
          <div
            data-testid="nav-drawer"
            className={`z-40 flex shrink-0 max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:w-[min(86vw,320px)] max-md:shadow-[6px_0_28px_rgba(20,8,40,.4)] max-md:transition-transform max-md:duration-200 ${
              drawerOpen ? 'max-md:translate-x-0' : 'max-md:-translate-x-full'
            }`}
          >
            <WorkspaceRail />
            <Sidebar />
          </div>
          {isMobile && drawerOpen && (
            <button
              data-testid="nav-drawer-backdrop"
              aria-label="Close menu"
              className="fixed inset-0 z-30 bg-black/40 md:hidden"
              onClick={() => setDrawerOpen(false)}
            />
          )}
          <div className="flex min-h-0 min-w-0 flex-1">
            {sel.channelId === ADMIN_VIEW_ID ? (
              <AdminView />
            ) : sel.channelId === ACTIVITY_VIEW_ID ? (
              <ActivityView />
            ) : sel.channelId ? (
              <>
                <ChannelView key={sel.channelId} channelId={sel.channelId} />
                {/* tabbed side panel: Thread + the channel's artifacts (phase 13) */}
                {(sel.threadRootId || sel.artifactId) && <SidePanel />}
              </>
            ) : (
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex h-[60px] items-center justify-between border-b border-hairline px-[22px]">
                  <MobileMenuButton />
                </div>
                <div className="flex flex-1 items-center justify-center text-faint">
                  Select a channel
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
     </MobileNavContext.Provider>
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
