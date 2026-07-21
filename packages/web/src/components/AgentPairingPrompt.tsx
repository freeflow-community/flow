// Sponsor approval prompt (AGENT_MEMBERS.md): an agent registered naming this
// user as sponsor. Floats above everything until approved/denied/expired —
// the code shown here matching the agent's terminal IS the security handshake.
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAgentRequests, useWorkspaces } from '../hooks';
import { AuthImg } from './Avatar';

/** The fixed preset set for the picker (robot faces bundled with the server). */
function useAgentAvatarPresets() {
  return useQuery({
    queryKey: ['agentAvatarPresets'],
    queryFn: () => api<{ avatars: { id: string; url: string }[] }>('GET', '/v1/agent-avatars'),
    select: (d) => d.avatars,
    staleTime: Infinity,
  });
}

export default function AgentPairingPrompt() {
  const qc = useQueryClient();
  const requests = useAgentRequests();
  const workspaces = useWorkspaces();
  const presets = useAgentAvatarPresets();
  const [workspaceId, setWorkspaceId] = useState<string>('');
  const [avatar, setAvatar] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const live = (requests.data ?? []).filter((r) => Date.parse(r.expiresAt) > Date.now());
  const req = live[0];
  if (!req) return null;
  const wsList = workspaces.data ?? [];
  const selectedWs = workspaceId || wsList[0]?.id || '';

  const resolve = async (action: 'approve' | 'deny') => {
    setError(null);
    setBusy(true);
    try {
      await api(
        'POST',
        `/v1/agent-requests/${req.id}/${action}`,
        action === 'approve' ? { workspaceId: selectedWs, ...(avatar ? { avatar } : {}) } : undefined,
      );
      setAvatar(null);
      await qc.invalidateQueries({ queryKey: ['agentRequests'] });
      await qc.invalidateQueries({ queryKey: ['members'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-x-0 top-4 z-50 flex justify-center px-4">
      <div
        data-testid="agent-pairing-prompt"
        className="w-full max-w-lg rounded-xl border border-hairline2 bg-base p-4 shadow-2xl"
      >
        <p className="mb-1 text-sm font-bold">
          🤖 {req.name} is asking to join as your agent
        </p>
        <p className="mb-2 text-xs text-muted">
          Username <span className="font-mono">{req.username}</span>
          {req.description ? ` — ${req.description}` : ''}. You will be the sponsor, responsible for what it
          does. Only approve if the code below matches the one in the agent&rsquo;s terminal.
        </p>
        <div className="mb-3 flex justify-center">
          <code data-testid="agent-pairing-code" className="rounded-lg bg-daypill px-4 py-2 text-xl font-bold tracking-widest">
            {req.code}
          </code>
        </div>
        {(presets.data?.length ?? 0) > 0 && (
          <div className="mb-3">
            <p className="mb-1 text-xs text-muted">Pick an avatar (optional)</p>
            <div className="flex flex-wrap gap-1.5">
              {presets.data!.map((p) => (
                <button
                  key={p.id}
                  data-testid={`agent-avatar-${p.id}`}
                  title={p.id}
                  className={`rounded-lg border-2 p-0.5 ${
                    avatar === p.id ? 'border-accent bg-accent/10' : 'border-transparent hover:border-hairline2'
                  }`}
                  onClick={() => setAvatar(avatar === p.id ? null : p.id)}
                >
                  <AuthImg path={p.url} alt={p.id} className="h-9 w-9 rounded-md object-contain" />
                </button>
              ))}
            </div>
          </div>
        )}
        {wsList.length > 1 && (
          <label className="mb-3 block text-xs text-muted">
            Admit into workspace
            <select
              data-testid="agent-pairing-workspace"
              className="mt-1 w-full rounded border border-hairline2 bg-base px-2 py-1.5 text-sm text-ink"
              value={selectedWs}
              onChange={(e) => setWorkspaceId(e.target.value)}
            >
              {wsList.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </label>
        )}
        {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            data-testid="agent-pairing-deny"
            className="rounded px-3 py-1.5 text-sm font-semibold text-red-600 hover:bg-red-600/10 disabled:opacity-50"
            disabled={busy}
            onClick={() => void resolve('deny')}
          >
            Deny
          </button>
          <button
            data-testid="agent-pairing-approve"
            className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
            disabled={busy || !selectedWs}
            onClick={() => void resolve('approve')}
          >
            Approve
          </button>
        </div>
        {live.length > 1 && (
          <p className="mt-2 text-xs text-faint">{live.length - 1} more request(s) queued behind this one.</p>
        )}
      </div>
    </div>
  );
}
