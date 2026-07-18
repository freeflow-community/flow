import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ChannelDTO, InviteDTO, UserDTO } from '@mychat/shared';
import { api, uploadAvatar } from '../lib/api';
import { useAuth, useSelection } from '../state';
import { useMembers } from '../hooks';
import { AuthImg } from './Avatar';

function Modal({ children, onClose, testid }: { children: React.ReactNode; onClose: () => void; testid?: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onMouseDown={onClose}>
      <div
        data-testid={testid}
        className="w-96 rounded-xl bg-white p-5 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

export function CreateChannelModal({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const sel = useSelection();
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    try {
      const ch = await api<ChannelDTO>('POST', `/v1/workspaces/${workspaceId}/channels`, {
        name: name.toLowerCase().replaceAll(' ', '-'),
        ...(topic ? { topic } : {}),
        isPrivate,
      });
      await qc.invalidateQueries({ queryKey: ['channels', workspaceId] });
      onClose();
      sel.selectChannel(ch.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed');
    }
  };

  return (
    <Modal onClose={onClose} testid="create-channel-modal">
      <h3 className="mb-3 font-bold">Create Channel</h3>
      <input data-testid="create-channel-name" className="mb-2 w-full rounded border border-hairline2 px-3 py-2 text-sm"
        placeholder="name (lowercase, a-z 0-9 - _)" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      <input className="mb-2 w-full rounded border border-hairline2 px-3 py-2 text-sm"
        placeholder="Topic (optional)" value={topic} onChange={(e) => setTopic(e.target.value)} />
      <label className="mb-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
        Private channel
      </label>
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <button className="px-3 py-1.5 text-sm text-ink-soft" onClick={onClose}>Cancel</button>
        <button data-testid="create-channel-submit"
          className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          disabled={!name.trim()} onClick={() => void create()}>Create</button>
      </div>
    </Modal>
  );
}

export function InviteModal({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const invite = async () => {
    setError(null);
    try {
      const inv = await api<InviteDTO>('POST', `/v1/workspaces/${workspaceId}/invites`, { email });
      setInviteUrl(inv.inviteUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed');
    }
  };

  return (
    <Modal onClose={onClose} testid="invite-modal">
      <h3 className="mb-3 font-bold">Invite People</h3>
      {inviteUrl ? (
        <>
          <p className="mb-2 text-sm text-ink-soft">Share this invite link (shown once):</p>
          <code data-testid="invite-url" className="mb-3 block rounded bg-daypill p-2 text-xs break-all select-all">{inviteUrl}</code>
          <div className="flex justify-end">
            <button className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-white" onClick={onClose}>Done</button>
          </div>
        </>
      ) : (
        <>
          <input data-testid="invite-email" className="mb-2 w-full rounded border border-hairline2 px-3 py-2 text-sm"
            placeholder="email@example.com" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button className="px-3 py-1.5 text-sm text-ink-soft" onClick={onClose}>Cancel</button>
            <button data-testid="invite-submit"
              className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
              disabled={!email.includes('@')} onClick={() => void invite()}>Create Invite</button>
          </div>
        </>
      )}
    </Modal>
  );
}

export function NewDmModal({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const auth = useAuth();
  const sel = useSelection();
  const qc = useQueryClient();
  const members = useMembers(workspaceId);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    try {
      const ch = await api<ChannelDTO>('POST', `/v1/workspaces/${workspaceId}/dms`, {
        userIds: Array.from(selected),
      });
      await qc.invalidateQueries({ queryKey: ['channels', workspaceId] });
      onClose();
      sel.selectChannel(ch.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed');
    }
  };

  return (
    <Modal onClose={onClose} testid="new-dm-modal">
      <h3 className="mb-1 font-bold">New Direct Message</h3>
      <p className="mb-3 text-sm text-muted">Pick one person for a DM, several for a group DM (max 8).</p>
      <div className="mc-scroll mb-3 max-h-56 overflow-y-auto">
        {(members.data ?? [])
          .filter((m) => m.userId !== auth.user.id)
          .map((m) => (
            <label key={m.userId} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-daypill/50">
              <input
                type="checkbox"
                data-testid={`dm-member-${m.displayName}`}
                checked={selected.has(m.userId)}
                onChange={(e) => {
                  const next = new Set(selected);
                  if (e.target.checked) next.add(m.userId);
                  else next.delete(m.userId);
                  setSelected(next);
                }}
              />
              {m.displayName}
            </label>
          ))}
      </div>
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <button className="px-3 py-1.5 text-sm text-ink-soft" onClick={onClose}>Cancel</button>
        <button data-testid="dm-start"
          className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          disabled={selected.size === 0 || selected.size > 8} onClick={() => void start()}>Start</button>
      </div>
    </Modal>
  );
}

/** Channel actions: notify level, invite members, leave, archive. */
export function ChannelMenu({ channel, onClose }: { channel: ChannelDTO; onClose: () => void }) {
  const sel = useSelection();
  const qc = useQueryClient();
  const auth = useAuth();
  const members = useMembers(sel.workspaceId);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());

  const refresh = () => qc.invalidateQueries({ queryKey: ['channels', sel.workspaceId] });

  const act = (fn: () => Promise<unknown>, close = true) => {
    void (async () => {
      setError(null);
      try {
        await fn();
        await refresh();
        if (close) onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'failed');
      }
    })();
  };

  const setLevel = (level: number) =>
    act(() => api('PUT', `/v1/channels/${channel.id}/notify`, { level }), false);

  const isDm = channel.kind !== 'standard';
  const candidates = (members.data ?? []).filter(
    (m) => m.userId !== auth.user.id && !(channel.memberIds ?? []).includes(m.userId),
  );

  return (
    <Modal onClose={onClose} testid="channel-menu-modal">
      <h3 className="mb-3 font-bold">{channel.name ? `#${channel.name}` : 'Conversation'} settings</h3>

      <p className="mb-1 text-xs font-semibold text-faint uppercase">Notifications</p>
      <div className="mb-3 flex gap-1">
        {[
          { level: 1, label: 'Mentions' },
          { level: 2, label: 'All' },
          { level: 0, label: 'Mute' },
        ].map((o) => (
          <button
            key={o.level}
            data-testid={`notify-${o.label.toLowerCase()}`}
            className={`rounded border px-3 py-1 text-sm ${channel.notifyLevel === o.level ? 'border-accent bg-accent/10 font-semibold' : 'border-hairline hover:bg-daypill/50'}`}
            onClick={() => setLevel(o.level)}
          >
            {o.label}
          </button>
        ))}
      </div>

      {!isDm && (
        <>
          <p className="mb-1 text-xs font-semibold text-faint uppercase">Invite to channel</p>
          <div className="mc-scroll mb-3 max-h-40 overflow-y-auto">
            {candidates.length === 0 && <p className="px-1 py-1 text-sm text-faint">Everyone is here.</p>}
            {candidates.map((m) => (
              <div key={m.userId} className="flex items-center justify-between px-1 py-1 text-sm">
                <span>{m.displayName}</span>
                {added.has(m.userId) ? (
                  <span className="text-xs text-green-600">added ✓</span>
                ) : (
                  <button
                    data-testid={`channel-add-${m.displayName}`}
                    className="text-xs text-accent-soft hover:underline"
                    onClick={() =>
                      act(async () => {
                        await api('POST', `/v1/channels/${channel.id}/members`, { userId: m.userId });
                        setAdded((prev) => new Set(prev).add(m.userId));
                      }, false)
                    }
                  >
                    Add
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}

      <div className="flex justify-between">
        <div className="flex gap-2">
          {(channel.kind === 'group_dm' || (!isDm && channel.name !== 'general')) && (
            <button
              data-testid="channel-leave"
              className="rounded border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
              onClick={() =>
                act(async () => {
                  await api('POST', `/v1/channels/${channel.id}/leave`);
                  if (sel.channelId === channel.id) sel.selectChannel(null);
                })
              }
            >
              Leave
            </button>
          )}
          {!isDm && channel.name !== 'general' && (
            <button
              data-testid="channel-archive"
              className="rounded border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
              onClick={() =>
                act(async () => {
                  await api('POST', `/v1/channels/${channel.id}/archive`);
                  if (sel.channelId === channel.id) sel.selectChannel(null);
                })
              }
            >
              Archive
            </button>
          )}
        </div>
        <button className="px-3 py-1.5 text-sm text-ink-soft" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}

export function ProfileModal({ onClose }: { onClose: () => void }) {
  const auth = useAuth();
  const qc = useQueryClient();
  const [displayName, setDisplayName] = useState(auth.user.displayName);
  const [timezone, setTimezone] = useState(auth.user.timezone || 'UTC');
  const [error, setError] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const timezones = Intl.supportedValuesOf('timeZone');

  const save = async () => {
    try {
      const me = await api<UserDTO>('PATCH', '/v1/me', { displayName, timezone });
      auth.setUser(me);
      await qc.invalidateQueries({ queryKey: ['members'] });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed');
    }
  };

  const pickAvatar = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setAvatarBusy(true);
    try {
      const me = (await uploadAvatar(file)) as UserDTO;
      auth.setUser(me);
      await qc.invalidateQueries({ queryKey: ['members'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'avatar failed');
    } finally {
      setAvatarBusy(false);
    }
  };

  return (
    <Modal onClose={onClose} testid="profile-modal">
      <h3 className="mb-3 font-bold">My Profile</h3>
      <div className="mb-3 flex items-center gap-3">
        {auth.user.avatarUrl ? (
          <AuthImg path={auth.user.avatarUrl} alt="avatar" className="h-14 w-14 rounded-full object-cover" />
        ) : (
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-daypill text-lg font-bold text-muted">
            {auth.user.displayName.slice(0, 1).toUpperCase()}
          </span>
        )}
        <label className="cursor-pointer text-sm text-accent-soft hover:underline">
          {avatarBusy ? 'Uploading…' : 'Change avatar…'}
          <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden
            data-testid="profile-avatar-input"
            onChange={(e) => void pickAvatar(e.target.files)} />
        </label>
      </div>
      <label className="mb-1 block text-xs font-semibold text-faint uppercase">Display name</label>
      <input data-testid="profile-name" className="mb-3 w-full rounded border border-hairline2 px-3 py-2 text-sm"
        value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      <label className="mb-1 block text-xs font-semibold text-faint uppercase">Timezone</label>
      <select data-testid="profile-timezone" className="mb-3 w-full rounded border border-hairline2 px-3 py-2 text-sm"
        value={timezone} onChange={(e) => setTimezone(e.target.value)}>
        {timezones.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
      </select>
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <button className="px-3 py-1.5 text-sm text-ink-soft" onClick={onClose}>Cancel</button>
        <button data-testid="profile-save"
          className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          disabled={!displayName.trim()} onClick={() => void save()}>Save</button>
      </div>
    </Modal>
  );
}

/** Member profile card: avatar, email, local time, Message button. */
export function UserCard({ userId, onClose }: { userId: string; onClose: () => void }) {
  const auth = useAuth();
  const sel = useSelection();
  const qc = useQueryClient();
  const [user, setUser] = useState<UserDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<UserDTO>('GET', `/v1/users/${userId}`)
      .then(setUser)
      .catch((err) => setError(err instanceof Error ? err.message : 'failed'));
  }, [userId]);

  const localTime = (tz: string) => {
    try {
      return `${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: tz })} local time (${tz})`;
    } catch {
      return tz;
    }
  };

  const message = async () => {
    if (!sel.workspaceId) return;
    try {
      const ch = await api<ChannelDTO>('POST', `/v1/workspaces/${sel.workspaceId}/dms`, { userIds: [userId] });
      await qc.invalidateQueries({ queryKey: ['channels', sel.workspaceId] });
      onClose();
      sel.selectChannel(ch.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed');
    }
  };

  return (
    <Modal onClose={onClose} testid="user-card">
      {user ? (
        <div className="flex flex-col items-center gap-2 text-center">
          {user.avatarUrl ? (
            <AuthImg path={user.avatarUrl} alt="avatar" className="h-16 w-16 rounded-full object-cover" />
          ) : (
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-daypill text-xl font-bold text-muted">
              {user.displayName.slice(0, 1).toUpperCase()}
            </span>
          )}
          <p data-testid="user-card-name" className="text-lg font-bold">{user.displayName}</p>
          <p className="text-sm text-muted select-all">{user.email}</p>
          <p data-testid="user-card-localtime" className="text-sm text-muted">{localTime(user.timezone)}</p>
          <div className="mt-2 flex gap-2">
            {userId !== auth.user.id && (
              <button data-testid="user-card-message"
                className="rounded bg-accent px-4 py-1.5 text-sm font-semibold text-white"
                onClick={() => void message()}>Message</button>
            )}
            <button className="rounded border border-hairline px-4 py-1.5 text-sm" onClick={onClose}>Close</button>
          </div>
        </div>
      ) : error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : (
        <p className="py-6 text-center text-sm text-faint">Loading…</p>
      )}
    </Modal>
  );
}
