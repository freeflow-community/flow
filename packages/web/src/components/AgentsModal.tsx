// First-class AI agents (AGENTS_DESIGN.md): admin-only, web client per ruling 4.
// Mint an agent invite (server URL + one-time key as a copy-paste pair) and
// remove agents from the workspace (confirm first).
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AgentInviteDTO } from '@flow/shared';
import { api } from '../lib/api';
import { useMembers } from '../hooks';
import { Modal } from './modals';

export function AgentsModal({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const members = useMembers(workspaceId);
  const [nameHint, setNameHint] = useState('');
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState<AgentInviteDTO | null>(null);
  const [copied, setCopied] = useState<'server' | 'key' | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [regenerated, setRegenerated] = useState<{ userId: string; token: string } | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const agents = (members.data ?? []).filter((m) => m.isAgent);
  const serverUrl = window.location.origin;

  const create = async () => {
    setError(null);
    setBusy(true);
    try {
      const inv = await api<AgentInviteDTO>('POST', `/v1/workspaces/${workspaceId}/agent-invites`, {
        ...(nameHint.trim() ? { nameHint: nameHint.trim() } : {}),
      });
      setInvite(inv);
      setCopied(null);
      setNameHint('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed');
    } finally {
      setBusy(false);
    }
  };

  const copy = async (which: 'server' | 'key') => {
    try {
      await navigator.clipboard.writeText(which === 'server' ? serverUrl : invite?.key ?? '');
      setCopied(which);
    } catch {
      setCopied(null);
    }
  };

  const regenerate = async (userId: string) => {
    setError(null);
    setBusy(true);
    try {
      const res = await api<{ agentToken: string }>('POST', `/v1/workspaces/${workspaceId}/agents/${userId}/token`);
      setRegenerated({ userId, token: res.agentToken });
      setTokenCopied(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed');
    } finally {
      setBusy(false);
    }
  };

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
        Agents join as real members with an 🤖 badge. Mint a one-time invite key and hand it (with the server
        URL) to the agent — see AGENTS.md for the bridge setup. The agent names itself when it registers;
        the hint below just labels the invite (and serves as a default name).
      </p>

      <div className="mb-2 flex gap-2">
        <input
          data-testid="agent-invite-name"
          className="w-full rounded border border-hairline2 px-3 py-2 text-sm"
          placeholder="Name hint (optional, e.g. RepoBot)"
          value={nameHint}
          onChange={(e) => setNameHint(e.target.value)}
          autoFocus
        />
        <button
          data-testid="agent-invite-submit"
          className="shrink-0 rounded bg-accent px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          disabled={busy}
          onClick={() => void create()}
        >
          Invite an Agent
        </button>
      </div>
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}

      {invite && (
        <div className="mb-3 rounded-lg border border-hairline2 bg-daypill/40 p-3">
          <p className="mb-2 text-xs text-red-600">Copy the key now — it won&rsquo;t be shown again (single-use, expires in 7 days).</p>
          <p className="mb-1 text-sm font-semibold">Server URL</p>
          <div className="mb-2 flex items-start gap-2">
            <code data-testid="agent-server-url" className="block grow rounded bg-daypill p-2 text-xs break-all select-all">
              {serverUrl}
            </code>
            <button
              className="shrink-0 rounded bg-accent px-3 py-1 text-xs font-semibold text-white"
              onClick={() => void copy('server')}
            >
              {copied === 'server' ? 'Copied ✓' : 'Copy'}
            </button>
          </div>
          <p className="mb-1 text-sm font-semibold">Invite key</p>
          <div className="flex items-start gap-2">
            <code data-testid="agent-invite-key" className="block grow rounded bg-daypill p-2 text-xs break-all select-all">
              {invite.key}
            </code>
            <button
              data-testid="agent-invite-key-copy"
              className="shrink-0 rounded bg-accent px-3 py-1 text-xs font-semibold text-white"
              onClick={() => void copy('key')}
            >
              {copied === 'key' ? 'Copied ✓' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      <p className="mb-1 text-xs font-semibold text-faint uppercase">Agents in this workspace</p>
      {agents.length === 0 && <p className="mb-2 px-1 text-sm text-faint">No agents yet.</p>}
      {agents.map((a) => (
        <div key={a.userId} className="flex items-center justify-between border-t border-hairline3 px-1 py-2 text-sm">
          <div className="min-w-0">
            <span className="font-semibold">{a.displayName} 🤖</span>
            {a.statusText && <span className="ml-2 truncate text-xs text-muted">{a.statusText}</span>}
          </div>
          {confirmRemove === a.userId ? (
            <span className="flex shrink-0 items-center gap-2">
              <span className="text-xs text-muted">Remove {a.displayName}? Tokens are revoked; history stays.</span>
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
            <span className="flex shrink-0 items-center gap-3">
              <button
                data-testid={`agent-regenerate-${a.displayName}`}
                className="text-xs text-accent-soft hover:underline disabled:opacity-50"
                disabled={busy}
                title="Revoke the current token and mint a new one (for a lost agent.json)"
                onClick={() => void regenerate(a.userId)}
              >
                Regenerate token
              </button>
              <button
                data-testid={`agent-remove-${a.displayName}`}
                className="text-xs text-red-600 hover:underline"
                onClick={() => setConfirmRemove(a.userId)}
              >
                Remove agent
              </button>
            </span>
          )}
        </div>
      ))}
      {regenerated && (
        <div className="mt-2 rounded-lg border border-hairline2 bg-daypill/40 p-3">
          <p className="mb-2 text-xs text-red-600">
            New agent token — copy it now, it won&rsquo;t be shown again. The old token no longer works.
            Paste it into the bridge setup (it accepts tokens as well as invite keys) or your agent.json.
          </p>
          <div className="flex items-start gap-2">
            <code data-testid="agent-token-regenerated" className="block grow rounded bg-daypill p-2 text-xs break-all select-all">
              {regenerated.token}
            </code>
            <button
              className="shrink-0 rounded bg-accent px-3 py-1 text-xs font-semibold text-white"
              onClick={() => {
                void navigator.clipboard.writeText(regenerated.token).then(() => setTokenCopied(true)).catch(() => {});
              }}
            >
              {tokenCopied ? 'Copied ✓' : 'Copy'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
