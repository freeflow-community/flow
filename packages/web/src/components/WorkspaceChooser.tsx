import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { WorkspaceDTO } from '@mychat/shared';
import { api } from '../lib/api';
import { useAuth, useSelection } from '../state';
import { useWorkspaces } from '../hooks';

export default function WorkspaceChooser() {
  const auth = useAuth();
  const sel = useSelection();
  const qc = useQueryClient();
  const workspaces = useWorkspaces();
  const [showCreate, setShowCreate] = useState(false);
  const [showAccept, setShowAccept] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [inviteToken, setInviteToken] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setError(null);
    try {
      const ws = await api<WorkspaceDTO>('POST', '/v1/workspaces', { name, slug });
      await qc.invalidateQueries({ queryKey: ['workspaces'] });
      sel.selectWorkspace(ws.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed');
    }
  };

  const accept = async () => {
    setError(null);
    try {
      let token = inviteToken.trim();
      const m = token.match(/invite\/([A-Za-z0-9_-]+)/);
      if (m) token = m[1]!;
      const ws = await api<WorkspaceDTO>('POST', '/v1/invites/accept', { token });
      await qc.invalidateQueries({ queryKey: ['workspaces'] });
      sel.selectWorkspace(ws.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed');
    }
  };

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-gray-50">
      <h1 className="text-2xl font-bold text-gray-900">Choose a Workspace</h1>
      <div className="w-96 space-y-2">
        {(workspaces.data ?? []).map((ws) => (
          <button
            key={ws.id}
            data-testid={`workspace-${ws.slug}`}
            onClick={() => sel.selectWorkspace(ws.id)}
            className="flex w-full items-center gap-3 rounded-lg border border-gray-200 bg-white p-3 text-left shadow-sm hover:border-blue-400"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600 font-bold text-white">
              {ws.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="flex-1">
              <span className="block font-semibold text-gray-900">{ws.name}</span>
              <span className="block text-sm text-gray-500">{ws.slug}</span>
            </span>
            {ws.role && <span className="text-xs text-gray-400">{ws.role}</span>}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <button
          className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-100"
          onClick={() => { setShowCreate((v) => !v); setShowAccept(false); }}
        >
          Create Workspace…
        </button>
        <button
          data-testid="accept-invite-toggle"
          className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-100"
          onClick={() => { setShowAccept((v) => !v); setShowCreate(false); }}
        >
          Accept Invite…
        </button>
        <button className="px-3 py-1.5 text-sm text-blue-600 hover:underline" onClick={auth.signOut}>
          Sign Out
        </button>
      </div>
      {showCreate && (
        <div className="flex w-96 flex-col gap-2 rounded-lg border border-gray-200 bg-white p-4">
          <input className="rounded border border-gray-300 px-3 py-2 text-sm" placeholder="Name"
            value={name} onChange={(e) => setName(e.target.value)} />
          <input className="rounded border border-gray-300 px-3 py-2 text-sm" placeholder="slug (lowercase-dashes)"
            value={slug} onChange={(e) => setSlug(e.target.value)} />
          <button className="rounded bg-blue-600 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={!name || !slug} onClick={create}>Create</button>
        </div>
      )}
      {showAccept && (
        <div className="flex w-96 flex-col gap-2 rounded-lg border border-gray-200 bg-white p-4">
          <input data-testid="accept-invite-token" className="rounded border border-gray-300 px-3 py-2 text-sm"
            placeholder="Invite link or token" value={inviteToken}
            onChange={(e) => setInviteToken(e.target.value)} />
          <button data-testid="accept-invite-submit"
            className="rounded bg-blue-600 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={!inviteToken.trim()} onClick={accept}>Accept</button>
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
