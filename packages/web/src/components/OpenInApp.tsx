// Web-to-app handoff CTA (operator feature): web is the auth surface; these
// controls mint a one-time code and deep-link into the native app, which
// exchanges it for its own session (raw tokens never ride in the URL).
import { useState } from 'react';
import { api } from '../lib/api';

const DISMISS_KEY = 'flow.appCtaDismissed';

/** Server route that 302s to the notarized macOS DMG in blob storage. */
export const MAC_DOWNLOAD_URL = '/download/mac';

// Setting `location.href` to a `flow://` URL never throws or rejects when no
// app is registered for the scheme, so we can't catch the "not installed"
// case directly. Heuristic: when the app *does* open, the browser backgrounds
// this page (a `blur` / `visibilitychange` fires). If neither happens shortly
// after we trigger the scheme, assume the app isn't installed and run onNoApp.
function launchScheme(url: string, onNoApp: () => void): void {
  let settled = false;
  const cleanup = () => {
    window.removeEventListener('blur', onHide);
    document.removeEventListener('visibilitychange', onVisibility);
  };
  const settle = (opened: boolean) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    cleanup();
    if (!opened) onNoApp();
  };
  const onHide = () => settle(true);
  const onVisibility = () => {
    if (document.hidden) settle(true);
  };
  const timer = window.setTimeout(() => settle(false), 1500);
  window.addEventListener('blur', onHide, { once: true });
  document.addEventListener('visibilitychange', onVisibility);
  window.location.href = url;
}

/**
 * Mint a one-time handoff code and open the native app via flow://signin.
 * If `onNoApp` is given, it fires when the app appears not to be installed.
 */
export async function openInApp(onNoApp?: () => void): Promise<void> {
  const { code } = await api<{ code: string; expiresAt: string }>('POST', '/v1/auth/app-link');
  const url = `flow://signin?code=${encodeURIComponent(code)}`;
  if (onNoApp) launchScheme(url, onNoApp);
  else window.location.href = url;
}

/** Small "Download for Mac" link — the fallback when the app isn't installed. */
function DownloadLink({ className = '' }: { className?: string }) {
  return (
    <a
      data-testid="download-mac"
      href={MAC_DOWNLOAD_URL}
      className={`font-semibold text-accent-soft hover:underline ${className}`}
    >
      Download for Mac ↓
    </a>
  );
}

/** Prominent CTA for the workspace chooser. */
export function OpenInAppButton() {
  const [noApp, setNoApp] = useState(false);
  return (
    <div className="flex flex-col items-center gap-1">
      <button
        data-testid="open-in-app"
        className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
        onClick={() => { setNoApp(false); void openInApp(() => setNoApp(true)).catch(() => setNoApp(true)); }}
      >
        Open the desktop app ↗
      </button>
      {noApp && (
        <p className="text-xs text-muted">
          App didn&apos;t open? <DownloadLink />
        </p>
      )}
    </div>
  );
}

/** Slim dismissible banner shown across the top of the signed-in app. */
export function OpenInAppBanner() {
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === '1');
  const [noApp, setNoApp] = useState(false);
  if (dismissed) return null;
  return (
    <div
      data-testid="open-in-app-banner"
      className="flex shrink-0 items-center justify-center gap-3 border-b border-hairline bg-white px-4 py-1.5 text-sm"
    >
      <span className="text-muted">Flow works best in the desktop app.</span>
      {noApp ? (
        <DownloadLink />
      ) : (
        <button
          data-testid="open-in-app-banner-open"
          className="font-semibold text-accent-soft hover:underline"
          onClick={() => void openInApp(() => setNoApp(true)).catch(() => setNoApp(true))}
        >
          Open the app ↗
        </button>
      )}
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
