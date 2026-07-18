import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { sidebarColor } from '@mychat/shared';
import type { ChannelDTO } from '@mychat/shared';
import { api } from '../lib/api';
import { useAuth, useLive, useSelection } from '../state';
import { useChannels, useMemberMap, useMembers, useNameMap, useWorkspaces } from '../hooks';
import { ChannelMenu, CreateChannelModal, InviteModal, NewDmModal, UserCard, WorkspaceColorModal } from './modals';
import StatusFooter from './StatusPicker';

// Sidebar width (phase 3.5 ruling 5): local per-device preference.
const WIDTH_KEY = 'mychat.sidebarWidth';
const DEFAULT_WIDTH = 240;
const clampWidth = (w: number) => Math.min(360, Math.max(180, w));
function storedWidth(): number {
  const w = Number(localStorage.getItem(WIDTH_KEY));
  return Number.isFinite(w) && w > 0 ? clampWidth(w) : DEFAULT_WIDTH;
}

export function dmTitle(c: ChannelDTO, names: Record<string, string>, me: string): string {
  const others = (c.memberIds ?? []).filter((id) => id !== me);
  if (others.length === 0) return 'Just you';
  return others.map((id) => names[id] ?? 'Unknown').sort().join(', ');
}

export default function Sidebar() {
  const auth = useAuth();
  const sel = useSelection();
  const live = useLive();
  const qc = useQueryClient();
  const workspaces = useWorkspaces();
  const channels = useChannels(sel.workspaceId);
  const members = useMembers(sel.workspaceId);
  const memberMap = useMemberMap(sel.workspaceId);
  const names = useNameMap(sel.workspaceId);
  const [wsMenuOpen, setWsMenuOpen] = useState(false);
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showNewDm, setShowNewDm] = useState(false);
  const [showColor, setShowColor] = useState(false);
  const [menuChannel, setMenuChannel] = useState<ChannelDTO | null>(null);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [memberMenuFor, setMemberMenuFor] = useState<string | null>(null);
  const [width, setWidth] = useState(storedWidth);
  const dragRef = useRef<{ x: number; w: number } | null>(null);
  const wsMenuRef = useRef<HTMLDivElement>(null);

  // Dismiss the workspace dropdown on outside click or Escape
  // (QA w7g2 finding: it previously only closed via the trigger).
  useEffect(() => {
    if (!wsMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (wsMenuRef.current && !wsMenuRef.current.contains(e.target as Node)) setWsMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setWsMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [wsMenuOpen]);

  const ws = (workspaces.data ?? []).find((w) => w.id === sel.workspaceId);
  const isAdmin = ws?.role === 'owner' || ws?.role === 'admin';
  const color = sidebarColor(ws?.sidebarColor);

  const openDm = async (userId: string) => {
    if (!sel.workspaceId) return;
    const ch = await api<ChannelDTO>('POST', `/v1/workspaces/${sel.workspaceId}/dms`, { userIds: [userId] });
    await qc.invalidateQueries({ queryKey: ['channels', sel.workspaceId] });
    sel.selectChannel(ch.id);
  };
  const all = channels.data ?? [];
  const joined = all.filter((c) => c.isMember && c.kind === 'standard');
  const dms = all.filter((c) => c.isMember && c.kind !== 'standard');
  const browsable = all.filter((c) => !c.isMember && !c.isPrivate && c.kind === 'standard');

  return (
    <aside
      className="relative flex shrink-0 flex-col text-white"
      style={{ width, background: `linear-gradient(to bottom, ${color.top}, ${color.bottom})` }}
    >
      <div ref={wsMenuRef} className="relative flex items-center justify-between px-3.5 pt-5 pb-2">
        <button
          data-testid="workspace-menu"
          className="flex min-w-0 items-center gap-1 rounded px-1 text-left text-base font-bold hover:bg-white/10"
          onClick={() => setWsMenuOpen((v) => !v)}
        >
          <span className="truncate">{ws?.name ?? 'Workspace'}</span>
          <span className="text-xs text-white/55">▾</span>
        </button>
        <button
          data-testid="sidebar-new-dm"
          title="New direct message"
          className="flex h-6 w-6 items-center justify-center rounded-[7px] bg-white/15 text-xs text-white hover:bg-white/25"
          onClick={() => setShowNewDm(true)}
        >
          ✎
        </button>
        {wsMenuOpen && (
          <div className="absolute top-12 left-3 right-3 z-20 rounded-lg bg-white py-1 text-ink shadow-[0_12px_40px_rgba(20,8,40,.4)]">
            {(workspaces.data ?? []).map((w) => (
              <MenuItem key={w.id} onClick={() => { setWsMenuOpen(false); sel.selectWorkspace(w.id); }}>
                {w.id === sel.workspaceId ? '✓ ' : ''}{w.name}
              </MenuItem>
            ))}
            <hr className="my-1 border-hairline3" />
            <MenuItem testid="menu-invite" onClick={() => { setWsMenuOpen(false); setShowInvite(true); }}>
              Invite People…
            </MenuItem>
            {isAdmin && (
              <MenuItem testid="menu-workspace-color" onClick={() => { setWsMenuOpen(false); setShowColor(true); }}>
                Workspace color…
              </MenuItem>
            )}
            <MenuItem onClick={() => { setWsMenuOpen(false); sel.selectWorkspace(null); }}>
              All Workspaces
            </MenuItem>
          </div>
        )}
      </div>

      <div className="mc-scroll mc-scroll-dark min-h-0 flex-1 overflow-y-auto px-3.5 pb-2 text-sm">
        <SectionHeader
          label="Channels"
          action={{ label: '+', testid: 'sidebar-create-channel', onClick: () => setShowCreateChannel(true) }}
        />
        {joined.map((c) => (
          <ChannelRow key={c.id} channel={c} label={c.name ?? ''} onMenu={() => setMenuChannel(c)} />
        ))}

        <SectionHeader label="Direct messages" />
        {dms.map((c) => {
          const title = dmTitle(c, names, auth.user.id);
          const otherId = (c.memberIds ?? []).find((id) => id !== auth.user.id);
          const status = otherId ? memberMap[otherId] : undefined;
          return (
            <ChannelRow
              key={c.id}
              channel={c}
              testid={`sidebar-dm-${title}`}
              label={title}
              statusEmoji={c.kind === 'dm' ? status?.statusEmoji : ''}
              statusTitle={c.kind === 'dm' ? status?.statusText : ''}
              leading={
                c.kind === 'dm' && otherId ? (
                  <PresenceDot online={!!live.presence[otherId]} />
                ) : (
                  <span className="text-xs text-white/60">👥</span>
                )
              }
              onMenu={() => setMenuChannel(c)}
            />
          );
        })}

        {browsable.length > 0 && (
          <>
            <SectionHeader label="Browse" />
            {browsable.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-lg px-2 py-[7px] text-white/70">
                <span className="truncate"><span className="opacity-60"># </span>{c.name}</span>
                <button
                  className="text-xs font-semibold text-white/80 hover:text-white hover:underline"
                  onClick={async () => {
                    await api('POST', `/v1/channels/${c.id}/join`);
                    await qc.invalidateQueries({ queryKey: ['channels', sel.workspaceId] });
                    sel.selectChannel(c.id);
                  }}
                >
                  Join
                </button>
              </div>
            ))}
          </>
        )}

        <SectionHeader label="Members" />
        {(members.data ?? []).map((m) => (
          <div
            key={m.userId}
            className="group relative flex items-center gap-[9px] rounded-lg px-2 py-[7px] hover:bg-white/10"
          >
            <button
              data-testid={`sidebar-member-${m.displayName}`}
              data-presence={live.presence[m.userId] ? 'online' : 'offline'}
              className="flex min-w-0 flex-1 items-center gap-[9px] text-left text-white/82"
              onClick={() => void openDm(m.userId)}
            >
              <PresenceDot online={!!live.presence[m.userId]} />
              <span className="truncate">{m.displayName}</span>
              {m.statusEmoji && (
                <span className="ml-0.5 text-sm" title={m.statusText}>{m.statusEmoji}</span>
              )}
              {m.userId === auth.user.id && <span className="text-xs text-white/55">(you)</span>}
              {m.role !== 'member' && <span className="ml-auto text-xs text-white/55">{m.role}</span>}
            </button>
            <button
              data-testid={`member-menu-${m.displayName}`}
              className="hidden rounded px-1 text-xs text-white/55 group-hover:block hover:text-white"
              onClick={() => setMemberMenuFor((v) => (v === m.userId ? null : m.userId))}
            >
              ⋯
            </button>
            {memberMenuFor === m.userId && (
              <div className="absolute top-full right-2 z-20 rounded-lg bg-white py-1 text-ink shadow-[0_12px_40px_rgba(20,8,40,.4)]">
                <MenuItem
                  testid={`member-profile-${m.displayName}`}
                  onClick={() => { setMemberMenuFor(null); setProfileUserId(m.userId); }}
                >
                  View profile
                </MenuItem>
              </div>
            )}
          </div>
        ))}
      </div>

      <StatusFooter />

      <div
        data-testid="sidebar-resizer"
        className="absolute inset-y-0 right-0 z-10 w-1 cursor-col-resize hover:bg-white/30"
        onPointerDown={(e) => {
          e.preventDefault();
          dragRef.current = { x: e.clientX, w: width };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const drag = dragRef.current;
          if (drag) setWidth(clampWidth(drag.w + e.clientX - drag.x));
        }}
        onPointerUp={(e) => {
          const drag = dragRef.current;
          if (!drag) return;
          dragRef.current = null;
          const final = clampWidth(drag.w + e.clientX - drag.x);
          setWidth(final);
          localStorage.setItem(WIDTH_KEY, String(final));
        }}
        onDoubleClick={() => {
          setWidth(DEFAULT_WIDTH);
          localStorage.setItem(WIDTH_KEY, String(DEFAULT_WIDTH));
        }}
      />

      {showCreateChannel && sel.workspaceId && (
        <CreateChannelModal workspaceId={sel.workspaceId} onClose={() => setShowCreateChannel(false)} />
      )}
      {showInvite && sel.workspaceId && <InviteModal workspaceId={sel.workspaceId} onClose={() => setShowInvite(false)} />}
      {showNewDm && sel.workspaceId && <NewDmModal workspaceId={sel.workspaceId} onClose={() => setShowNewDm(false)} />}
      {showColor && sel.workspaceId && <WorkspaceColorModal workspaceId={sel.workspaceId} onClose={() => setShowColor(false)} />}
      {menuChannel && <ChannelMenu channel={menuChannel} onClose={() => setMenuChannel(null)} />}
      {profileUserId && <UserCard userId={profileUserId} onClose={() => setProfileUserId(null)} />}
    </aside>
  );
}

function PresenceDot({ online }: { online: boolean }) {
  return (
    <span
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${online ? 'bg-online' : 'border-[1.5px] border-white/40'}`}
    />
  );
}

function SectionHeader({
  label,
  action,
}: {
  label: string;
  action?: { label: string; testid: string; onClick: () => void };
}) {
  return (
    <div className="mt-4 mb-1 flex items-center justify-between px-2 first:mt-1">
      <span className="text-[11px] font-semibold tracking-[.06em] text-white/55 uppercase">{label}</span>
      {action && (
        <button
          data-testid={action.testid}
          className="rounded px-1 text-white/55 hover:bg-white/10 hover:text-white"
          onClick={action.onClick}
          title="Create a channel"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

function ChannelRow({
  channel,
  label,
  leading,
  statusEmoji,
  statusTitle,
  testid,
  onMenu,
}: {
  channel: ChannelDTO;
  label: string;
  leading?: React.ReactNode;
  statusEmoji?: string;
  statusTitle?: string;
  testid?: string;
  onMenu: () => void;
}) {
  const sel = useSelection();
  const active = sel.channelId === channel.id;
  const unread = channel.unreadCount > 0;
  return (
    <div
      className={`group flex items-center gap-[9px] rounded-lg px-2 py-[7px] ${
        active ? 'bg-white text-accent-deep' : 'hover:bg-white/10'
      }`}
    >
      <button
        data-testid={testid ?? `sidebar-channel-${channel.name}`}
        data-unread={channel.unreadCount}
        className="flex min-w-0 flex-1 items-center gap-[9px] text-left"
        onClick={() => sel.selectChannel(channel.id)}
      >
        {leading ?? (
          <span className={active ? 'opacity-60' : 'text-white/60'}>{channel.isPrivate ? '🔒' : '#'}</span>
        )}
        <span
          className={`truncate ${
            active ? 'font-[650]' : unread ? 'font-[650] text-white' : 'text-white/82'
          }`}
        >
          {label}
        </span>
        {statusEmoji && (
          <span className="ml-0.5 shrink-0 text-sm" title={statusTitle}>{statusEmoji}</span>
        )}
        {channel.notifyLevel === 0 && <span className="text-xs opacity-60">🔕</span>}
        {unread && (
          <span className="ml-auto rounded-[9px] bg-unread px-[7px] py-px text-[11px] font-bold text-white">
            {channel.unreadCount}
          </span>
        )}
      </button>
      <button
        data-testid={`channel-menu-${channel.name ?? channel.id}`}
        className={`hidden rounded px-1 text-xs group-hover:block ${
          active ? 'text-accent-deep/60 hover:text-accent-deep' : 'text-white/55 hover:text-white'
        }`}
        onClick={onMenu}
      >
        ⋯
      </button>
    </div>
  );
}

function MenuItem({
  children,
  onClick,
  testid,
}: {
  children: React.ReactNode;
  onClick: () => void;
  testid?: string;
}) {
  return (
    <button
      data-testid={testid}
      className="block w-full px-3 py-1.5 text-left text-sm hover:bg-accent/10"
      onClick={onClick}
    >
      {children}
    </button>
  );
}
