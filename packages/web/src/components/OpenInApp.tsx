// Web-to-app handoff CTA (operator feature): web is the auth surface; these
// controls mint a one-time code and deep-link into the native app, which
// exchanges it for its own session (raw tokens never ride in the URL).
import { useState } from 'react';
import { api } from '../lib/api';

const DISMISS_KEY = 'flow.appCtaDismissed';

/** Mint a one-time handoff code and open the native app via flow://signin. */
export async function openInApp(): Promise<void> {
  const { code } = await api<{ code: string; expiresAt: string }>('POST', '/v1/auth/app-link');
  window.location.href = `flow://signin?code=${encodeURIComponent(code)}`;
}

/** Prominent CTA for the workspace chooser. */
export function OpenInAppButton() {
  const [error, setError] = useState(false);
  return (
    <div className="flex flex-col items-center gap-1">
      <button
        data-testid="open-in-app"
        className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
        onClick={() => { setError(false); void openInApp().catch(() => setError(true)); }}
      >
        Open the desktop app ↗
      </button>
      {error && <p className="text-xs text-red-600">Couldn't open the app — is it installed?</p>}
    </div>
  );
}

/** Slim dismissible banner shown across the top of the signed-in app. */
export function OpenInAppBanner() {
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === '1');
  if (dismissed) return null;
  return (
    <div
      data-testid="open-in-app-banner"
      className="flex shrink-0 items-center justify-center gap-3 border-b border-hairline bg-white px-4 py-1.5 text-sm"
    >
      <span className="text-muted">Flow works best in the desktop app.</span>
      <button
        data-testid="open-in-app-banner-open"
        className="font-semibold text-accent-soft hover:underline"
        onClick={() => void openInApp().catch(() => {})}
      >
        Open the app ↗
      </button>
      <button
        data-testid="open-in-app-banner-dismiss"
        className="ml-2 text-faint hover:text-ink"
        title="Dismiss"
        onClick={() => {
          localStorage.setItem(DISMISS_KEY, '1');
          setDismissed(true);
        }}
      >
        ✕
      </button>
    </div>
  );
}
