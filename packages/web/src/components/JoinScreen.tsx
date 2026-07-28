import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type {
  AuthResponse,
  JoinLinkPreviewDTO,
  UserDTO,
  WorkspaceDTO,
} from '@flow/shared';
import { api } from '../lib/api';
import { useWorkspaces } from '../hooks';
import AuthScreen from './AuthScreen';

/**
 * The landing page for /join/<slug>/<token> (issue #85). Before this existed
 * the token was redeemed silently in the background, so following a join link
 * looked exactly like being dumped on the app home page — nothing named the
 * workspace, and nothing confirmed the join. The unauthenticated preview
 * endpoint was built for this page; now something calls it.
 *
 * Signed out, it wraps AuthScreen so the sign-in/register card can say which
 * workspace is on the other side. Signed in, it asks before joining.
 */

const card = 'w-80 rounded-xl border border-hairline bg-white p-6 shadow-sm text-center';
const primary =
  'w-full rounded bg-accent py-2 text-sm font-semibold text-white hover:bg-accent-deep disabled:opacity-50';
const secondary = 'mt-3 w-full text-center text-sm text-muted hover:text-ink';

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-base">
      <div className={card} data-testid="join-screen">
        <h1 className="mb-3 text-center text-2xl font-bold text-ink">Flow</h1>
        {children}
      </div>
    </div>
  );
}

/**
 * The signed-in half. Split out so `useWorkspaces` is only ever called with a
 * session behind it — the preview is public, the workspace list is not.
 */
export function JoinConfirm({
  token,
  preview,
  user,
  onJoined,
  onDismiss,
}: {
  token: string;
  preview: JoinLinkPreviewDTO;
  user: UserDTO;
  onJoined: (ws: WorkspaceDTO, alreadyMember: boolean) => void;
  onDismiss: () => void;
}) {
  const qc = useQueryClient();
  const workspaces = useWorkspaces();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Redeeming is idempotent, so joining twice is harmless — but telling
  // someone "Join" for a workspace they're already in reads as broken.
  const member = (workspaces.data ?? []).some((w) => w.id === preview.workspaceId);

  const join = () => {
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        const ws = await api<WorkspaceDTO>('POST', '/v1/join-links/redeem', { token });
        await qc.invalidateQueries({ queryKey: ['workspaces'] });
        onJoined(ws, member);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'could not join');
        setBusy(false);
      }
    })();
  };

  return (
    <Shell>
      <p className="mb-1 text-sm text-muted">{member ? 'You’re already a member of' : 'You’ve been invited to join'}</p>
      <p data-testid="join-workspace-name" className="mb-4 text-lg font-semibold text-ink">
        {preview.name}
      </p>
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      <button data-testid="join-submit" className={primary} disabled={busy} onClick={join}>
        {busy ? 'Joining…' : member ? `Open ${preview.name}` : 'Join workspace'}
      </button>
      <p className="mt-3 text-xs text-faint">
        Signed in as <span className="font-semibold text-muted">{user.email}</span>
      </p>
      <button type="button" data-testid="join-dismiss" className={secondary} onClick={onDismiss}>
        Not now
      </button>
    </Shell>
  );
}

export default function JoinScreen({
  token,
  user,
  onSignedIn,
  signupToken,
  resetToken,
  signinToken,
  onJoined,
  onDismiss,
}: {
  token: string;
  user: UserDTO | null;
  onSignedIn: (r: AuthResponse & { autoJoined?: WorkspaceDTO[] }) => void;
  signupToken?: string | null;
  resetToken?: string | null;
  signinToken?: string | null;
  onJoined: (ws: WorkspaceDTO, alreadyMember: boolean) => void;
  onDismiss: () => void;
}) {
  const [preview, setPreview] = useState<JoinLinkPreviewDTO | null>(null);
  const [dead, setDead] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const p = await api<JoinLinkPreviewDTO>('GET', `/v1/join-links/${encodeURIComponent(token)}`);
        if (alive) setPreview(p);
      } catch {
        // 404 means revoked, regenerated, or mistyped. Offline and 500 land
        // here too and say the same thing — less accurate than a retry, but it
        // beats stranding someone on a spinner, and "Continue to Flow" is a
        // way out either way.
        if (alive) setDead(true);
      }
    })();
    return () => { alive = false; };
  }, [token]);

  if (dead) {
    return (
      <Shell>
        <p data-testid="join-invalid" className="mb-4 text-sm text-muted">
          This join link is no longer valid. Ask whoever shared it for a fresh one.
        </p>
        <button className={primary} onClick={onDismiss}>
          Continue to Flow
        </button>
      </Shell>
    );
  }

  if (!preview) {
    return (
      <Shell>
        <p className="text-sm text-faint">Checking your invitation…</p>
      </Shell>
    );
  }

  if (!user) {
    return (
      <AuthScreen
        onSignedIn={onSignedIn}
        signupToken={signupToken}
        resetToken={resetToken}
        signinToken={signinToken}
        joinWorkspace={preview.name}
      />
    );
  }

  return (
    <JoinConfirm token={token} preview={preview} user={user} onJoined={onJoined} onDismiss={onDismiss} />
  );
}
