// Admin panel (owner/admin, web-only per operator ruling — like Apps/Agents).
// A virtual content-pane view (not a real channel) reached from the workspace
// menu's "Manage Users…" and pinned into the sidebar as the "Manage users" row.
// Lists workspace members and lets owners/admins change roles and remove people.
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { MemberRole, WorkspaceMemberDTO } from '@flow/shared';
import { api } from '../lib/api';
import { useAuth, useSelection } from '../state';
import { useMembers, useWorkspaces } from '../hooks';
import { Avatar } from './Avatar';
import { MobileMenuButton } from './MobileMenuButton';
import { AgentMarkIcon, ShieldIcon } from './icons';

export default function AdminView() {
  const auth = useAuth();
  const sel = useSelection();
  const workspaces = useWorkspaces();
  const members = useMembers(sel.workspaceId);

  const ws = (workspaces.data ?? []).find((w) => w.id === sel.workspaceId);
  const isAdmin = ws?.role === 'owner' || ws?.role === 'admin';
  const roster = (members.data ?? []).slice().sort((a, b) => {
    // Owner first, then admins, then members; alphabetical within a rank.
    const rank = (r: MemberRole) => (r === 'owner' ? 0 : r === 'admin' ? 1 : 2);
    return rank(a.role) - rank(b.role) || a.displayName.localeCompare(b.displayName);
  });

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-base">
      <header className="flex h-[60px] shrink-0 items-center justify-between border-b border-hairline px-[22px] max-md:px-3">
        <MobileMenuButton />
        <div className="min-w-0 flex-1">
          <h2 data-testid="admin-header" className="flex items-center gap-1.5 truncate text-[15px] font-bold">
            <ShieldIcon size={14} /> Manage users
          </h2>
          <p className="truncate text-xs text-muted">{ws?.name ?? 'Workspace'} members &amp; roles</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            data-testid="admin-close"
            className="text-sm text-muted hover:text-ink hover:underline"
            onClick={() => sel.closeAdminPanel()}
          >
            Close
          </button>
        </div>
      </header>

      <div className="mc-scroll min-h-0 flex-1 overflow-y-auto px-[22px] py-5">
        {!isAdmin ? (
          <p data-testid="admin-no-access" className="text-sm text-muted">
            You no longer have admin access to this workspace.
          </p>
        ) : (
          <div className="mx-auto max-w-3xl">
            <p className="mb-4 text-sm text-muted">
              {roster.length} {roster.length === 1 ? 'member' : 'members'}. Owners and admins can change
              roles and remove people. The workspace owner can't be changed or removed.
            </p>
            <div className="overflow-hidden rounded-lg border border-hairline">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-hairline bg-daypill/40 text-left text-xs text-faint uppercase">
                    <th className="px-3 py-2 font-semibold">Member</th>
                    <th className="px-3 py-2 font-semibold">Role</th>
                    <th className="px-3 py-2 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {roster.map((m) => (
                    <MemberRow key={m.userId} member={m} meId={auth.user.id} workspaceId={sel.workspaceId!} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function MemberRow({
  member,
  meId,
  workspaceId,
}: {
  member: WorkspaceMemberDTO;
  meId: string;
  workspaceId: string;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isOwner = member.role === 'owner';
  const isSelf = member.userId === meId;
  // Owner is immutable; you can't act on yourself (no self-lockout).
  const locked = isOwner || isSelf;

  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['members', workspaceId] }),
      qc.invalidateQueries({ queryKey: ['workspaces'] }),
    ]);

  const setRole = async (role: Exclude<MemberRole, 'owner'>) => {
    if (role === member.role) return;
    setBusy(true);
    setError(null);
    try {
      await api('PATCH', `/v1/workspaces/${workspaceId}/members/${member.userId}/role`, { role });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong — please try again.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('DELETE', `/v1/workspaces/${workspaceId}/members/${member.userId}`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong — please try again.');
      setBusy(false);
      setConfirmRemove(false);
    }
    // On success the row disappears with the roster refetch — no state to reset.
  };

  return (
    <tr data-testid={`admin-member-${member.email}`} className="border-b border-hairline last:border-0">
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-2.5">
          <Avatar userId={member.userId} name={member.displayName} avatarUrl={member.avatarUrl} size={30} radius={9} />
          <div className="min-w-0">
            <div className="truncate font-semibold">
              {member.displayName}
              {member.isAgent && <span className="ml-1 inline-flex align-baseline text-accent-soft" title="AI agent"><AgentMarkIcon size={11} /></span>}
              {isSelf && <span className="text-faint"> (you)</span>}
            </div>
            <div className="truncate text-xs text-muted">{member.email}</div>
          </div>
        </div>
      </td>
      <td className="px-3 py-2.5">
        {locked ? (
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${
              isOwner ? 'bg-accent/10 text-accent-deep' : 'bg-daypill text-ink-soft'
            }`}
          >
            {member.role}
          </span>
        ) : (
          <select
            data-testid={`admin-role-${member.email}`}
            className="rounded border border-hairline bg-base px-2 py-1 text-sm disabled:opacity-50"
            value={member.role}
            disabled={busy}
            onChange={(e) => void setRole(e.target.value as Exclude<MemberRole, 'owner'>)}
          >
            <option value="admin">Admin</option>
            <option value="member">Member</option>
          </select>
        )}
      </td>
      <td className="px-3 py-2.5 text-right">
        {error && <span className="mr-2 text-xs text-red-600">{error}</span>}
        {locked ? (
          <span className="text-xs text-faint">—</span>
        ) : confirmRemove ? (
          <span className="inline-flex items-center gap-2">
            <span className="text-xs text-muted">Remove?</span>
            <button
              data-testid={`admin-remove-confirm-${member.email}`}
              className="rounded bg-red-600 px-2 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              disabled={busy}
              onClick={() => void remove()}
            >
              Yes
            </button>
            <button
              className="text-xs text-muted hover:underline"
              disabled={busy}
              onClick={() => setConfirmRemove(false)}
            >
              No
            </button>
          </span>
        ) : (
          <button
            data-testid={`admin-remove-${member.email}`}
            className="rounded border border-red-200 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
            disabled={busy}
            onClick={() => setConfirmRemove(true)}
          >
            Remove
          </button>
        )}
      </td>
    </tr>
  );
}
