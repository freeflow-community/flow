import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ChannelDTO } from '@mychat/shared';
import { api } from '../lib/api';
import { useAuth, useLive, useSelection } from '../state';
import { useChannels, useMembers, useNameMap, useWorkspaces } from '../hooks';
import { ChannelMenu, CreateChannelModal, InviteModal, NewDmModal, ProfileModal, UserCard } from './modals';

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
  const names = useNameMap(sel.workspaceId);
  const [wsMenuOpen, setWsMenuOpen] = useState(false);
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showNewDm, setShowNewDm] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [menuChannel, setMenuChannel] = useState<ChannelDTO | null>(null);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);

  const ws = (workspaces.data ?? []).find((w) => w.id === sel.workspaceId);
  const all = channels.data ?? [];
  const joined = all.filter((c) => c.isMember && c.kind === 'standard');
  const dms = all.filter((c) => c.isMember && c.kind !== 'standard');
  const browsable = all.filter((c) => !c.isMember && !c.isPrivate && c.kind === 'standard');

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-gray-200 bg-gray-50">
      <div className="relative border-b border-gray-200 p-2">
        <button
          data-testid="workspace-menu"
          className="flex w-full items-center justify-between rounded px-2 py-1.5 font-semibold hover:bg-gray-200"
          onClick={() => setWsMenuOpen((v) => !v)}
        >
          <span className="truncate">{ws?.name ?? 'Workspace'}</span>
          <span className="text-xs text-gray-500">▾</span>
        </button>
        {wsMenuOpen && (
          <div className="absolute left-2 right-2 z-20 mt-1 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
            {(workspaces.data ?? []).map((w) => (
              <MenuItem key={w.id} onClick={() => { setWsMenuOpen(false); sel.selectWorkspace(w.id); }}>
                {w.id === sel.workspaceId ? '✓ ' : ''}{w.name}
              </MenuItem>
            ))}
            <hr className="my-1 border-gray-100" />
            <MenuItem testid="menu-profile" onClick={() => { setWsMenuOpen(false); setShowProfile(true); }}>
              My Profile…
            </MenuItem>
            <MenuItem testid="menu-invite" onClick={() => { setWsMenuOpen(false); setShowInvite(true); }}>
              Invite People…
            </MenuItem>
            <MenuItem onClick={() => { setWsMenuOpen(false); sel.selectWorkspace(null); }}>
              All Workspaces
            </MenuItem>
            <hr className="my-1 border-gray-100" />
            <MenuItem testid="menu-signout" onClick={auth.signOut}>Sign Out</MenuItem>
          </div>
        )}
      </div>

      <div className="mc-scroll min-h-0 flex-1 overflow-y-auto px-2 py-2 text-sm">
        <SectionHeader
          label="Channels"
          action={{ label: '+', testid: 'sidebar-create-channel', onClick: () => setShowCreateChannel(true) }}
        />
        {joined.map((c) => (
          <ChannelRow key={c.id} channel={c} label={`#${c.name}`} onMenu={() => setMenuChannel(c)} />
        ))}

        <SectionHeader
          label="Direct Messages"
          action={{ label: '+', testid: 'sidebar-new-dm', onClick: () => setShowNewDm(true) }}
        />
        {dms.map((c) => {
          const title = dmTitle(c, names, auth.user.id);
          const otherId = (c.memberIds ?? []).find((id) => id !== auth.user.id);
          return (
            <ChannelRow
              key={c.id}
              channel={c}
              testid={`sidebar-dm-${title}`}
              label={title}
              leading={
                c.kind === 'dm' && otherId ? (
                  <span
                    className={`inline-block h-2 w-2 rounded-full ${live.presence[otherId] ? 'bg-green-500' : 'bg-gray-300'}`}
                  />
                ) : (
                  <span className="text-xs text-gray-400">👥</span>
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
              <div key={c.id} className="flex items-center justify-between rounded px-2 py-1 text-gray-500">
                <span className="truncate">#{c.name}</span>
                <button
                  className="text-xs text-blue-600 hover:underline"
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
          <button
            key={m.userId}
            data-testid={`sidebar-member-${m.displayName}`}
            data-presence={live.presence[m.userId] ? 'online' : 'offline'}
            className="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-gray-200"
            onClick={() => setProfileUserId(m.userId)}
          >
            <span
              className={`inline-block h-2 w-2 rounded-full ${live.presence[m.userId] ? 'bg-green-500' : 'bg-gray-300'}`}
            />
            <span className="truncate">{m.displayName}</span>
            {m.userId === auth.user.id && <span className="text-xs text-gray-400">(you)</span>}
            {m.role !== 'member' && <span className="ml-auto text-xs text-gray-400">{m.role}</span>}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 border-t border-gray-200 px-3 py-2 text-xs text-gray-500">
        <span
          data-testid="connection-status"
          className={`inline-block h-2 w-2 rounded-full ${live.status === 'connected' ? 'bg-green-500' : 'bg-orange-400'}`}
        />
        {live.status === 'connected' ? 'Connected' : live.status === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
      </div>

      {showCreateChannel && sel.workspaceId && (
        <CreateChannelModal workspaceId={sel.workspaceId} onClose={() => setShowCreateChannel(false)} />
      )}
      {showInvite && sel.workspaceId && <InviteModal workspaceId={sel.workspaceId} onClose={() => setShowInvite(false)} />}
      {showNewDm && sel.workspaceId && <NewDmModal workspaceId={sel.workspaceId} onClose={() => setShowNewDm(false)} />}
      {showProfile && <ProfileModal onClose={() => setShowProfile(false)} />}
      {menuChannel && <ChannelMenu channel={menuChannel} onClose={() => setMenuChannel(null)} />}
      {profileUserId && <UserCard userId={profileUserId} onClose={() => setProfileUserId(null)} />}
    </aside>
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
    <div className="mt-3 mb-1 flex items-center justify-between px-2 first:mt-0">
      <span className="text-xs font-semibold tracking-wide text-gray-400 uppercase">{label}</span>
      {action && (
        <button
          data-testid={action.testid}
          className="rounded px-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600"
          onClick={action.onClick}
          title={label === 'Channels' ? 'Create a channel' : 'New direct message'}
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
  testid,
  onMenu,
}: {
  channel: ChannelDTO;
  label: string;
  leading?: React.ReactNode;
  testid?: string;
  onMenu: () => void;
}) {
  const sel = useSelection();
  const active = sel.channelId === channel.id;
  return (
    <div
      className={`group flex items-center gap-2 rounded px-2 py-1 ${active ? 'bg-blue-600 text-white' : 'hover:bg-gray-200'}`}
    >
      <button
        data-testid={testid ?? `sidebar-channel-${channel.name}`}
        data-unread={channel.unreadCount}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
        onClick={() => sel.selectChannel(channel.id)}
      >
        {leading ?? <span className={active ? 'text-blue-200' : 'text-gray-400'}>{channel.isPrivate ? '🔒' : '#'}</span>}
        <span className={`truncate ${channel.unreadCount > 0 && !active ? 'font-bold' : ''}`}>{label}</span>
        {channel.notifyLevel === 0 && <span className="text-xs opacity-60">🔕</span>}
        {channel.unreadCount > 0 && (
          <span className="ml-auto rounded-full bg-red-500 px-1.5 text-xs font-bold text-white">
            {channel.unreadCount}
          </span>
        )}
      </button>
      <button
        data-testid={`channel-menu-${channel.name ?? channel.id}`}
        className={`hidden rounded px-1 text-xs group-hover:block ${active ? 'text-blue-100' : 'text-gray-400 hover:text-gray-700'}`}
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
      className="block w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100"
      onClick={onClick}
    >
      {children}
    </button>
  );
}
