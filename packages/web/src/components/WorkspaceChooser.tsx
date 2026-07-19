import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { WorkspaceDTO } from '@mychat/shared';
import { api } from '../lib/api';
import { useAuth, useSelection } from '../state';
import { useWorkspaces } from '../hooks';
import { OpenInAppButton } from './OpenInApp';

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
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-base">
      <h1 className="text-2xl font-bold text-ink">Choose a Workspace</h1>
      <OpenInAppButton />
      <div className="w-96 space-y-2">
        {(workspaces.data ?? []).map((ws) => (
          <button
            key={ws.id}
            data-testid={`workspace-${ws.slug}`}
            onClick={() => sel.selectWorkspace(ws.id)}
            className="flex w-full items-center gap-3 rounded-lg border border-hairline bg-white p-3 text-left shadow-sm hover:border-accent"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent font-bold text-white">
              {ws.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="flex-1">
              <span className="block font-semibold text-ink">{ws.name}</span>
              <span className="block text-sm text-muted">{ws.slug}</span>
            </span>
            {ws.role && <span className="text-xs text-faint">{ws.role}</span>}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <button
          className="rounded border border-hairline2 bg-white px-3 py-1.5 text-sm hover:bg-daypill"
          onClick={() => { setShowCreate((v) => !v); setShowAccept(false); }}
        >
          Create Workspace…
        </button>
        <button
          data-testid="accept-invite-toggle"
          className="rounded border border-hairline2 bg-white px-3 py-1.5 text-sm hover:bg-daypill"
          onClick={() => { setShowAccept((v) => !v); setShowCreate(false); }}
        >
          Accept Invite…
        </button>
        <button className="px-3 py-1.5 text-sm text-accent-soft hover:underline" onClick={auth.signOut}>
          Sign Out
        </button>
      </div>
      {showCreate && (
        <div className="flex w-96 flex-col gap-2 rounded-lg border border-hairline bg-white p-4">
          <input className="rounded border border-hairline2 px-3 py-2 text-sm" placeholder="Name"
            value={name} onChange={(e) => setName(e.target.value)} />
          <input className="rounded border border-hairline2 px-3 py-2 text-sm" placeholder="slug (lowercase-dashes)"
            value={slug} onChange={(e) => setSlug(e.target.value)} />
          <button className="rounded bg-accent py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={!name || !slug} onClick={create}>Create</button>
        </div>
      )}
      {showAccept && (
        <div className="flex w-96 flex-col gap-2 rounded-lg border border-hairline bg-white p-4">
          <input data-testid="accept-invite-token" className="rounded border border-hairline2 px-3 py-2 text-sm"
            placeholder="Invite link or token" value={inviteToken}
            onChange={(e) => setInviteToken(e.target.value)} />
          <button data-testid="accept-invite-submit"
            className="rounded bg-accent py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={!inviteToken.trim()} onClick={accept}>Accept</button>
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
