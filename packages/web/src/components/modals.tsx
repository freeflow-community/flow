import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { SIDEBAR_COLORS } from '@flow/shared';
import type { ChannelDTO, InviteDTO, JoinLinkDTO, NotificationPrefs, UserDTO } from '@flow/shared';
import { api, uploadAvatar } from '../lib/api';
import { useAuth, useSelection } from '../state';
import { useChannelMembers, useMemberMap, useMembers, useSelfRegisterDomain, useWorkspaces } from '../hooks';
import { AuthImg, Avatar } from './Avatar';

export function Modal({
  children,
  onClose,
  testid,
  wide,
}: {
  children: React.ReactNode;
  onClose: () => void;
  testid?: string;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onMouseDown={onClose}>
      <div
        data-testid={testid}
        className={`${
          // cap to the viewport on phones so the dialog never overflows
          wide ? 'w-[min(560px,calc(100vw-2rem))]' : 'w-[min(24rem,calc(100vw-2rem))]'
        } max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl bg-white p-5 text-ink shadow-2xl`}
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

/**
 * Channel options (#188): name, topic and delete, reached from the header's
 * "⋯" menu — the same three on every client. Deleting is the server's archive
 * (soft: the channel leaves the sidebar and goes read-only), and #general
 * can be neither renamed nor deleted.
 */
export function ChannelOptionsModal({ channel, onClose }: { channel: ChannelDTO; onClose: () => void }) {
  const qc = useQueryClient();
  const sel = useSelection();
  const [name, setName] = useState(channel.name ?? '');
  const [topic, setTopic] = useState(channel.topic ?? '');
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isGeneral = channel.name === 'general';

  const remove = async () => {
    try {
      await api('POST', `/v1/channels/${channel.id}/archive`);
      await qc.invalidateQueries({ queryKey: ['channels', channel.workspaceId] });
      if (sel.channelId === channel.id) sel.selectChannel(null);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed');
    }
  };

  const save = async () => {
    try {
      await api('PATCH', `/v1/channels/${channel.id}`, {
        ...(isGeneral ? {} : { name: name.toLowerCase().replaceAll(' ', '-') }),
        topic, // '' clears
      });
      await qc.invalidateQueries({ queryKey: ['channels', channel.workspaceId] });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed');
    }
  };

  return (
    <Modal onClose={onClose} testid="channel-options-modal">
      <h3 className="mb-3 font-bold">Channel options</h3>
      <label className="mb-1 block text-xs font-semibold text-faint uppercase">Name</label>
      <input data-testid="edit-channel-name" className="mb-2 w-full rounded border border-hairline2 px-3 py-2 text-sm disabled:opacity-60"
        placeholder="name (lowercase, a-z 0-9 - _)" value={name} disabled={isGeneral}
        title={isGeneral ? '#general cannot be renamed' : undefined}
        onChange={(e) => setName(e.target.value)} autoFocus={!isGeneral} />
      <label className="mb-1 block text-xs font-semibold text-faint uppercase">Topic</label>
      <input data-testid="edit-channel-topic" className="mb-3 w-full rounded border border-hairline2 px-3 py-2 text-sm"
        placeholder="What's this channel about?" value={topic} maxLength={250}
        onChange={(e) => setTopic(e.target.value)} autoFocus={isGeneral}
        onKeyDown={(e) => { if (e.key === 'Enter') void save(); }} />
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      <div className="flex items-center justify-between gap-2">
        {isGeneral ? (
          <span />
        ) : confirmDelete ? (
          <button data-testid="channel-delete-confirm"
            className="rounded bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700"
            onClick={() => void remove()}>Really delete?</button>
        ) : (
          <button data-testid="channel-delete"
            className="rounded border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
            onClick={() => setConfirmDelete(true)}>Delete channel</button>
        )}
        <div className="flex gap-2">
          <button className="px-3 py-1.5 text-sm text-ink-soft" onClick={onClose}>Cancel</button>
          <button data-testid="edit-channel-save"
            className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
            disabled={!isGeneral && !name.trim()} onClick={() => void save()}>Save</button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Google domain self-registration (phase16 §5a), offered in the invite dialog
 * because "let everyone at acme.com in" is the same job as inviting them one
 * by one. Only shown to an owner/admin who signed in with Google on a
 * non-consumer domain; the server re-checks all of that.
 */
function SelfRegisterToggle({ workspaceId }: { workspaceId: string }) {
  const qc = useQueryClient();
  const workspaces = useWorkspaces();
  const domain = useSelfRegisterDomain();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ws = (workspaces.data ?? []).find((w) => w.id === workspaceId);
  if (!ws || !domain) return null;
  const on = ws.googleSelfRegisterDomain === domain;

  const toggle = async (next: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await api('PATCH', `/v1/workspaces/${workspaceId}`, { googleSelfRegisterDomain: next ? domain : null });
      await qc.invalidateQueries({ queryKey: ['workspaces'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 border-t border-hairline pt-3">
      <label data-testid="invite-self-register" className="flex items-start gap-2 text-sm text-ink-soft">
        <input type="checkbox" className="mt-0.5" checked={on} disabled={busy}
          onChange={(e) => void toggle(e.target.checked)} />
        <span>
          Let anyone with an <span className="font-semibold text-ink">@{domain}</span> email join automatically when
          they sign in with Google — no invite needed.
        </span>
      </label>
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
}

/**
 * The workspace's persistent join link (issue #85) — the "drop it in a doc"
 * counterpart to emailing one address at a time. One link is live at a time:
 * Regenerate replaces it (which kills the old URL) and Revoke removes it.
 */
function JoinLinkSection({ workspaceId }: { workspaceId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  // null = still asking; false = the server said no (not an owner/admin), which
  // is the same permission that gates emailed invites, so we hide the section.
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const link = await api<JoinLinkDTO>('GET', `/v1/workspaces/${workspaceId}/join-link`);
        if (!live) return;
        setUrl(link.joinUrl);
        setAllowed(true);
      } catch {
        if (live) setAllowed(false);
      }
    })();
    return () => { live = false; };
  }, [workspaceId]);

  const run = async (method: 'POST' | 'DELETE') => {
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const link = await api<JoinLinkDTO>(method, `/v1/workspaces/${workspaceId}/join-link`);
      setUrl(link.joinUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed');
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
  };

  if (!allowed) return null;

  return (
    <div className="mt-4 border-t border-hairline pt-3" data-testid="join-link-section">
      <p className="mb-1 text-sm font-semibold">Share a join link</p>
      <p className="mb-2 text-xs text-ink-soft">
        Anyone with this link can join the workspace. It stays valid until you regenerate or revoke it.
      </p>
      {url ? (
        <>
          <code data-testid="join-link-url" className="mb-2 block rounded bg-daypill p-2 text-xs break-all select-all">{url}</code>
          <div className="flex gap-2">
            <button data-testid="join-link-copy"
              className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
              disabled={busy} onClick={() => void copy()}>{copied ? 'Copied' : 'Copy link'}</button>
            <button data-testid="join-link-regenerate"
              className="px-3 py-1.5 text-sm text-ink-soft disabled:opacity-50"
              disabled={busy} onClick={() => void run('POST')}>Regenerate</button>
            <button data-testid="join-link-revoke"
              className="px-3 py-1.5 text-sm text-red-600 disabled:opacity-50"
              disabled={busy} onClick={() => void run('DELETE')}>Revoke</button>
          </div>
        </>
      ) : (
        <button data-testid="join-link-create"
          className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          disabled={busy} onClick={() => void run('POST')}>Create join link</button>
      )}
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
}

export function InviteModal({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [invite, setInvite] = useState<InviteDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inviteUrl = invite?.inviteUrl ?? null;

  const create = async () => {
    setError(null);
    try {
      setInvite(await api<InviteDTO>('POST', `/v1/workspaces/${workspaceId}/invites`, { email }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed');
    }
  };

  return (
    <Modal onClose={onClose} testid="invite-modal">
      <h3 className="mb-3 font-bold">Invite People</h3>
      {inviteUrl ? (
        <>
          <p className="mb-2 text-sm text-ink-soft" data-testid="invite-result">
            {invite?.emailSent
              ? `Invite emailed to ${invite.email}. You can also share this link (shown once):`
              : 'The invite email could not be sent — share this link yourself (shown once):'}
          </p>
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
              disabled={!email.includes('@')} onClick={() => void create()}>Send Invite</button>
          </div>
          <SelfRegisterToggle workspaceId={workspaceId} />
        </>
      )}
      {/* Always available, emailed invite or not: the link is the workspace's,
          not this dialog's. Renders nothing for non-admins. */}
      <JoinLinkSection workspaceId={workspaceId} />
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
              {m.isAgent && <span title="AI agent"> 🤖</span>}
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
  // Real membership (standard channels have no memberIds in the DTO): keeps
  // the invite list from offering people who are already here.
  const chanMembers = useChannelMembers(channel.id);
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
    (m) => m.userId !== auth.user.id && !(chanMembers.data ?? channel.memberIds ?? []).includes(m.userId),
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
                <span>
                  {m.displayName}
                  {m.isAgent && <span title="AI agent"> 🤖</span>}
                </span>
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

/** Workspace sidebar color picker (phase 3.5 ruling 3): admins only reach this. */
export function WorkspaceColorModal({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const workspaces = useWorkspaces();
  const current = (workspaces.data ?? []).find((w) => w.id === workspaceId)?.sidebarColor;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async (id: string) => {
    setError(null);
    setBusy(true);
    try {
      await api('PATCH', `/v1/workspaces/${workspaceId}`, { sidebarColor: id });
      await qc.invalidateQueries({ queryKey: ['workspaces'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose} testid="workspace-color-modal">
      <h3 className="mb-3 font-bold">Workspace color</h3>
      <div className="mb-3 grid grid-cols-4 gap-2">
        {SIDEBAR_COLORS.map((c) => (
          <button
            key={c.id}
            data-testid={`color-swatch-${c.id}`}
            title={c.name}
            disabled={busy}
            className={`flex h-12 items-center justify-center rounded-lg text-white ${
              current === c.id ? 'ring-2 ring-accent ring-offset-2' : 'hover:opacity-85'
            }`}
            style={{ background: `linear-gradient(to bottom, ${c.top}, ${c.bottom})` }}
            onClick={() => void pick(c.id)}
          >
            {current === c.id ? '✓' : ''}
          </button>
        ))}
      </div>
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      <div className="flex justify-end">
        <button className="px-3 py-1.5 text-sm text-ink-soft" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}

/** One live-saved notification-pref toggle (phase 10 settings). */
function PrefToggle({
  label,
  hint,
  checked,
  onChange,
  testid,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  testid: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 py-1 text-sm text-ink">
      <input
        type="checkbox"
        data-testid={testid}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-accent"
      />
      <span>
        {label}
        {hint && <span className="text-xs text-faint"> — {hint}</span>}
      </span>
    </label>
  );
}

export function ProfileModal({ onClose }: { onClose: () => void }) {
  const auth = useAuth();
  const qc = useQueryClient();
  const [displayName, setDisplayName] = useState(auth.user.displayName);
  const [timezone, setTimezone] = useState(auth.user.timezone || 'UTC');
  const [error, setError] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const timezones = Intl.supportedValuesOf('timeZone');
  const prefs = auth.user.notificationPrefs;

  /** App Store 5.1.1(v) parity: the same self-service deletion the apps offer. */
  const deleteAccount = async () => {
    setDeleteBusy(true);
    setError(null);
    try {
      await api('DELETE', '/v1/me');
      auth.signOut(); // local teardown; its logout POST failing on the dead session is fine
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed');
      setDeleteBusy(false);
    }
  };

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

  /** Live-saved pref toggle: one PATCH per flip, shallow-merged server-side. */
  const setPref = async (key: keyof NotificationPrefs, value: boolean) => {
    try {
      const me = await api<UserDTO>('PATCH', '/v1/me', { notificationPrefs: { [key]: value } });
      auth.setUser(me);
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
      <h3 className="mb-3 font-bold">Settings</h3>
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

      <div className="mt-2 mb-1 border-t border-hairline pt-3 text-xs font-semibold text-faint uppercase">
        Notifications
      </div>
      <p className="mb-1 text-xs text-faint">Off means no banner — everything still lands in the 🔔 list.</p>
      <PrefToggle testid="pref-dm" label="Direct messages" hint="any message in a DM"
        checked={prefs.dm !== false} onChange={(v) => void setPref('dm', v)} />
      <PrefToggle testid="pref-mention" label="Mentions of me" hint="@you"
        checked={prefs.mention !== false} onChange={(v) => void setPref('mention', v)} />
      <PrefToggle testid="pref-group-mention" label="Group mentions" hint="@here, @channel"
        checked={prefs.groupMention !== false} onChange={(v) => void setPref('groupMention', v)} />
      <PrefToggle testid="pref-thread-reply" label="Thread replies" hint="threads you started or joined"
        checked={prefs.threadReply !== false} onChange={(v) => void setPref('threadReply', v)} />
      <PrefToggle testid="pref-reaction" label="Reactions" hint="someone reacts to your message"
        checked={prefs.reaction !== false} onChange={(v) => void setPref('reaction', v)} />
      <PrefToggle testid="pref-persistent" label="Keep banners on screen" hint="until dismissed (browser permitting)"
        checked={prefs.persistentBanners === true} onChange={(v) => void setPref('persistentBanners', v)} />

      <div className="mt-3 border-t border-hairline pt-3">
        {confirmingDelete ? (
          <div data-testid="profile-delete-confirm">
            <p className="mb-2 text-sm text-red-600">
              Permanently delete your account? You leave every workspace, your email is freed for future
              use, and this cannot be undone. Past messages remain, attributed to your name.
            </p>
            <div className="flex gap-2">
              <button data-testid="profile-delete-really"
                className="rounded bg-red-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
                disabled={deleteBusy} onClick={() => void deleteAccount()}>
                {deleteBusy ? 'Deleting…' : 'Delete my account'}
              </button>
              <button className="px-3 py-1.5 text-sm text-ink-soft" disabled={deleteBusy}
                onClick={() => setConfirmingDelete(false)}>Keep my account</button>
            </div>
          </div>
        ) : (
          <button data-testid="profile-delete"
            className="text-sm text-red-600 hover:underline"
            onClick={() => setConfirmingDelete(true)}>Delete account…</button>
        )}
      </div>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <div className="mt-3 flex justify-end gap-2">
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
  const memberMap = useMemberMap(sel.workspaceId);
  const [user, setUser] = useState<UserDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Agents carry a human sponsor; the id lives on the workspace roster, not the
  // /v1/users payload, so resolve name + avatar from the member map (ui_nits).
  const sponsorId = user?.isAgent ? memberMap[userId]?.sponsorId ?? null : null;
  const sponsor = sponsorId ? memberMap[sponsorId] : undefined;

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
          <p data-testid="user-card-name" className="text-lg font-bold">
            {user.displayName}
            {user.isAgent && <span title="AI agent"> 🤖</span>}
          </p>
          {user.isAgent && <p className="text-xs text-muted">AI agent</p>}
          <p className="text-sm text-muted select-all">{user.email}</p>
          <p data-testid="user-card-localtime" className="text-sm text-muted">{localTime(user.timezone)}</p>
          {sponsor && (
            <div
              data-testid="user-card-sponsor"
              className="mt-1 flex items-center gap-2 rounded-lg bg-daypill px-3 py-1.5"
            >
              <span className="text-xs text-muted">Sponsored by</span>
              <Avatar
                userId={sponsor.userId}
                name={sponsor.displayName}
                avatarUrl={sponsor.avatarUrl}
                size={20}
                radius={6}
              />
              <span className="text-sm font-semibold">{sponsor.displayName}</span>
            </div>
          )}
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
