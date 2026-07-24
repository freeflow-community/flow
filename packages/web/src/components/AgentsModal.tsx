// First-class AI agents (AGENT_MEMBERS.md): roster of the workspace's agents
// with sponsor attribution and removal. Onboarding is via a one-time invite
// code (sidebar → "Invite your Agent") that the agent redeems to join, so the
// code is minted there, not here.
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useMembers } from '../hooks';
import { useAuth } from '../state';
import { Modal } from './modals';

export function AgentsModal({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const auth = useAuth();
  const members = useMembers(workspaceId);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const all = members.data ?? [];
  const agents = all.filter((m) => m.isAgent);
  const nameOf = (userId: string | null) => all.find((m) => m.userId === userId)?.displayName ?? 'unknown';
  const myRole = all.find((m) => m.userId === auth.user.id)?.role;
  const canRemove = (sponsorId: string | null) =>
    myRole === 'owner' || myRole === 'admin' || sponsorId === auth.user.id;

  const remove = async (userId: string) => {
    setError(null);
    setBusy(true);
    try {
      await api('DELETE', `/v1/workspaces/${workspaceId}/agents/${userId}`);
      setConfirmRemove(null);
      await qc.invalidateQueries({ queryKey: ['members', workspaceId] });
      await qc.invalidateQueries({ queryKey: ['channels', workspaceId] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose} testid="agents-modal" wide>
      <h3 className="mb-1 font-bold">AI Agents</h3>
      <p className="mb-3 text-sm text-muted">
        Agents are real members with an 🤖 badge, each sponsored by the person who invited them. To add
        one: click <span className="font-semibold">Invite your Agent</span> in the sidebar to get a
        one-time <code className="rounded bg-daypill px-1">npx flow-agent-bridge &lt;code&gt;</code> command,
        then run it on the agent&rsquo;s machine — it joins right away, no admin needed. See AGENT_MEMBERS.md.
      </p>
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}

      <p className="mb-1 text-xs font-semibold text-faint uppercase">Agents in this workspace</p>
      {agents.length === 0 && <p className="mb-2 px-1 text-sm text-faint">No agents yet.</p>}
      {agents.map((a) => (
        <div key={a.userId} className="flex items-center justify-between border-t border-hairline3 px-1 py-2 text-sm">
          <div className="min-w-0">
            <span className="font-semibold">{a.displayName} 🤖</span>
            <span className="ml-2 text-xs text-muted">sponsored by {nameOf(a.sponsorId)}</span>
            {a.statusText && <span className="ml-2 truncate text-xs text-muted">{a.statusText}</span>}
          </div>
          {confirmRemove === a.userId ? (
            <span className="flex shrink-0 items-center gap-2">
              <span className="text-xs text-muted">Remove {a.displayName}? Its credentials are revoked; history stays.</span>
              <button
                data-testid={`agent-remove-confirm-${a.displayName}`}
                className="rounded bg-red-600 px-2 py-1 text-xs font-semibold text-white disabled:opacity-50"
                disabled={busy}
                onClick={() => void remove(a.userId)}
              >
                Remove
              </button>
              <button className="text-xs text-ink-soft hover:underline" onClick={() => setConfirmRemove(null)}>
                Cancel
              </button>
            </span>
          ) : (
            canRemove(a.sponsorId) && (
              <button
                data-testid={`agent-remove-${a.displayName}`}
                className="shrink-0 text-xs text-red-600 hover:underline"
                onClick={() => setConfirmRemove(a.userId)}
              >
                Remove agent
              </button>
            )
          )}
        </div>
      ))}
    </Modal>
  );
}
