// Native "Continue with Google" handoff page (phase16 §9, option 1).
//
// The Mac and iPhone apps have no Google SDK: their button opens the system
// browser at `/?native=google`, which lands here. We run Google Identity
// Services exactly as the normal auth screen does, then mint a one-time
// app-link code and bounce to `flow://signin?code=…` — the same handoff the
// "Open the desktop app" button has always used, so the app needs no new
// crypto and no new deep link. A raw session token never rides in the URL.
//
// Arriving already signed in on the web skips straight to the handoff: the
// point of the trip is the code, not the sign-in. That shortcut is the
// convenience of the flow and its sharpest edge (#279) — it signs you in as
// whoever the browser already holds, without ever asking Google — so every
// phase after `choose` carries a way back out to the account chooser.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { GoogleAuthResponse } from '@flow/shared';
import { setToken } from '../lib/api';
import { GoogleButton } from './AuthScreen';
import { MAC_DOWNLOAD_URL, isIOSDevice, openInApp } from './OpenInApp';

type Phase = 'choose' | 'handing-off' | 'sent' | 'no-app' | 'error';

export default function NativeSignIn({ signedIn }: { signedIn: boolean }) {
  const [phase, setPhase] = useState<Phase>(signedIn ? 'handing-off' : 'choose');
  const [error, setError] = useState<string | null>(null);

  // A handoff must never overlap itself. Each one mints a single-use app-link
  // code and navigates to flow://, so firing twice opens the app twice and
  // races two sign-ins in it — and the auto-handoff below runs from an effect,
  // which StrictMode deliberately double-invokes in development. Cleared when
  // the attempt settles, so the retry button still works.
  const inFlight = useRef(false);

  const handOff = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPhase('handing-off');
    setError(null);
    void openInApp(() => setPhase('no-app')).then(
      () => {
        inFlight.current = false;
        setPhase((p) => (p === 'handing-off' ? 'sent' : p));
      },
      (err: unknown) => {
        inFlight.current = false;
        setError(err instanceof Error ? err.message : 'could not reach Flow');
        setPhase('error');
      },
    );
  }, []);

  // Already signed in here: no need to ask Google anything.
  useEffect(() => {
    if (signedIn) handOff();
  }, [signedIn, handOff]);

  // "Not you?" — the browser's own Flow session is what made the handoff
  // silent, so drop it and go back to the Google button, which asks. Safe at
  // any phase: the code already minted is single-use and tied to the old
  // account, and signing in again mints a fresh one.
  const useDifferentAccount = useCallback(() => {
    inFlight.current = false;
    setToken(null);
    setError(null);
    setPhase('choose');
  }, []);

  const onGoogle = useCallback(
    (resp: GoogleAuthResponse) => {
      // Keep the web session too — it's legitimately theirs, and it makes a
      // second trip through this page a one-tap affair.
      setToken(resp.token);
      handOff();
    },
    [handOff],
  );

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-base">
      <div className="w-80 rounded-xl border border-hairline bg-white p-6 text-center shadow-sm">
        <h1 className="mb-1 text-center text-2xl font-bold text-ink">Flow</h1>
        {phase === 'choose' && (
          <>
            <p className="mb-1 text-sm text-muted">
              Sign in with Google, and we&rsquo;ll send you back to the Flow app.
            </p>
            <GoogleButton onSignedIn={onGoogle} showDivider={false} />
          </>
        )}
        {phase === 'handing-off' && <p className="text-sm text-muted">Signing you in…</p>}
        {phase === 'sent' && (
          <>
            <p className="mb-3 text-sm text-muted">
              You&rsquo;re signed in — Flow should be opening now.
            </p>
            <button
              data-testid="native-retry"
              className="w-full rounded bg-accent py-2 text-sm font-semibold text-white hover:bg-accent-deep"
              onClick={handOff}
            >
              Open the Flow app ↗
            </button>
            <p className="mt-2 text-xs text-faint">You can close this tab once Flow opens.</p>
          </>
        )}
        {phase === 'no-app' && (
          <>
            <p className="mb-3 text-sm text-muted">
              You&rsquo;re signed in, but Flow didn&rsquo;t open — is it installed?
            </p>
            {isIOSDevice ? (
              <p className="text-sm text-muted">Make sure the Flow app is installed.</p>
            ) : (
              <a
                data-testid="native-download"
                href={MAC_DOWNLOAD_URL}
                className="text-sm font-semibold text-accent-soft hover:underline"
              >
                Download for Mac ↓
              </a>
            )}
            <button
              className="mt-3 block w-full rounded border border-hairline2 py-2 text-sm font-semibold text-ink hover:bg-base"
              onClick={handOff}
            >
              Try again
            </button>
          </>
        )}
        {phase === 'error' && (
          <>
            <p className="mb-3 text-sm text-red-600">{error}</p>
            <button
              className="w-full rounded border border-hairline2 py-2 text-sm font-semibold text-ink hover:bg-base"
              onClick={handOff}
            >
              Try again
            </button>
          </>
        )}
        {phase !== 'choose' && (
          <button
            type="button"
            data-testid="native-switch-account"
            className="mt-3 w-full text-xs font-semibold text-accent-soft hover:underline"
            onClick={useDifferentAccount}
          >
            Not you? Use a different account
          </button>
        )}
      </div>
      <a href="/" className="text-sm text-muted hover:text-ink hover:underline">
        Use Flow in this browser instead
      </a>
    </div>
  );
}
