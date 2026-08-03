import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { WorkspaceDTO } from '@flow/shared';
import { api } from '../lib/api';
import { useAuth, useSelection } from '../state';
import { useSelfRegisterDomain, useWorkspaces } from '../hooks';
import { OpenInAppButton } from './OpenInApp';
import { AgentMarkIcon } from './icons';

const inputCls =
  'rounded-lg border border-hairline2 bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-faint transition-colors duration-150 focus:border-accent/60 focus:outline-none';
const primaryCls =
  'rounded-lg bg-accent py-2.5 text-sm font-semibold text-white transition-[background-color,transform] duration-150 ease-out-quart enabled:hover:bg-accent-deep enabled:active:scale-[0.985] disabled:opacity-40';

/** "Acme Design Team" → "acme-design-team" — the user never has to learn what a slug is. */
function deriveSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export default function WorkspaceChooser() {
  const auth = useAuth();
  const sel = useSelection();
  const qc = useQueryClient();
  const workspaces = useWorkspaces();
  // Non-null only for a Google-authenticated creator on a non-consumer domain
  // (phase16 §5a) — we only ever offer *their* domain, never free text.
  const selfRegisterDomain = useSelfRegisterDomain();
  const [showCreate, setShowCreate] = useState(false);
  const [showAccept, setShowAccept] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [openToDomain, setOpenToDomain] = useState(false);
  const [inviteToken, setInviteToken] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setError(null);
    try {
      const ws = await api<WorkspaceDTO>('POST', '/v1/workspaces', {
        name,
        slug,
        ...(openToDomain && selfRegisterDomain ? { googleSelfRegisterDomain: selfRegisterDomain } : {}),
      });
      await qc.invalidateQueries({ queryKey: ['workspaces'] });
      sel.selectWorkspace(ws.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That didn’t work — mind trying again?');
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
      setError(err instanceof Error ? err.message : 'That invite didn’t work — check the link and try again.');
    }
  };

  const haveWorkspaces = (workspaces.data ?? []).length > 0;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 overflow-y-auto bg-base bg-[radial-gradient(90%_65%_at_50%_-5%,oklch(0.95_0.022_183)_0%,transparent_72%)] px-4 py-8">
      <div className="flex flex-col items-center gap-1.5">
        <div className="flex items-center gap-2 text-ink">
          <span className="flex text-accent" aria-hidden>
            <AgentMarkIcon size={18} />
          </span>
          <h1 className="font-display text-[26px] leading-none font-bold tracking-tight">
            {haveWorkspaces ? 'Choose a workspace' : 'Welcome to Flow'}
          </h1>
        </div>
        {!haveWorkspaces && (
          <p className="text-sm text-muted">
            You&rsquo;re not in a workspace yet — create one, or paste an invite from your team.
          </p>
        )}
      </div>
      <div className="w-96 max-w-full space-y-2">
        {(workspaces.data ?? []).map((ws) => (
          <button
            key={ws.id}
            data-testid={`workspace-${ws.slug}`}
            onClick={() => sel.selectWorkspace(ws.id)}
            className="flex w-full items-center gap-3 rounded-xl border border-hairline bg-white p-3 text-left shadow-card transition-[transform,border-color,box-shadow] duration-150 ease-out-quart hover:-translate-y-px hover:border-accent/40 hover:shadow-pop"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent font-semibold text-white">
              {ws.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold text-ink">{ws.name}</span>
              <span className="block truncate text-sm text-muted">{ws.slug}</span>
            </span>
            {ws.role && <span className="text-xs text-faint">{ws.role}</span>}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          className="rounded-lg border border-hairline2 bg-white px-3.5 py-2 text-sm font-medium transition-colors duration-150 hover:bg-daypill"
          onClick={() => { setShowCreate((v) => !v); setShowAccept(false); }}
        >
          Create a workspace
        </button>
        <button
          data-testid="accept-invite-toggle"
          className="rounded-lg border border-hairline2 bg-white px-3.5 py-2 text-sm font-medium transition-colors duration-150 hover:bg-daypill"
          onClick={() => { setShowAccept((v) => !v); setShowCreate(false); }}
        >
          Accept an invite
        </button>
        <button className="px-3 py-2 text-sm text-accent-soft hover:underline" onClick={auth.signOut}>
          Sign out
        </button>
      </div>
      {showCreate && (
        <div className="flex w-96 max-w-full flex-col gap-2 rounded-xl border border-hairline bg-white p-4 shadow-pop">
          <input
            className={inputCls}
            placeholder="Workspace name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!slugTouched) setSlug(deriveSlug(e.target.value));
            }}
          />
          <input
            className={inputCls}
            placeholder="short-url-name"
            value={slug}
            onChange={(e) => { setSlugTouched(true); setSlug(deriveSlug(e.target.value) || e.target.value); }}
          />
          <p className="-mt-1 px-1 text-xs text-faint">
            The short name appears in links — we&rsquo;ve suggested one from the name.
          </p>
          {selfRegisterDomain && (
            <label data-testid="create-ws-self-register" className="flex items-start gap-2 text-sm text-ink-soft">
              <input type="checkbox" className="mt-0.5 accent-(--color-accent)" checked={openToDomain}
                onChange={(e) => setOpenToDomain(e.target.checked)} />
              <span>
                Let anyone with an <span className="font-semibold text-ink">@{selfRegisterDomain}</span> email join
                this workspace automatically
              </span>
            </label>
          )}
          <button className={primaryCls} disabled={!name || !slug} onClick={create}>Create workspace</button>
        </div>
      )}
      {showAccept && (
        <div className="flex w-96 max-w-full flex-col gap-2 rounded-xl border border-hairline bg-white p-4 shadow-pop">
          <input data-testid="accept-invite-token" className={inputCls}
            placeholder="Paste an invite link or token" value={inviteToken}
            onChange={(e) => setInviteToken(e.target.value)} />
          <button data-testid="accept-invite-submit"
            className={primaryCls}
            disabled={!inviteToken.trim()} onClick={accept}>Join workspace</button>
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <OpenInAppButton />
    </div>
  );
}
