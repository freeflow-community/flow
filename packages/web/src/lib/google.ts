// Google Identity Services (phase16 §5). GIS hands the browser a signed ID
// token; we post it to /v1/auth/google and the server verifies it. Nothing
// secret lives here — an OAuth *web* client id is public by design.
import type { AuthResponse, GoogleAuthResponse, PublicConfigDTO } from '@flow/shared';
import { activeRuntime, type ConnectionRuntime } from './connectionRuntime';
import { awaitSignInCode, installDeepLinks } from './deepLinks';
import { getHost } from './host';

/** "Continue with Google" in the desktop shell (docs/specs/desktop-electron.md).
 * Google refuses to sign in inside an embedded browser, so the shell does what
 * the macOS app does: open the server's native handoff page in the system
 * browser, wait for the `flow://signin?code=` link it bounces back, and trade
 * the one-time code for a session. No Google script is loaded in the app. */
export async function desktopGoogleSignIn(runtime: ConnectionRuntime, signal: AbortSignal): Promise<GoogleAuthResponse> {
  installDeepLinks();
  const pending = awaitSignInCode(signal);
  getHost().links.openExternal(`${runtime.origin}/?native=google`);
  const { code } = await pending;
  const session = await runtime.api<AuthResponse>('POST', '/v1/auth/app-link/exchange', { code });
  // The app-link exchange issues a plain session; domain auto-join happened
  // (or not) on the web side, and the workspace list shows the result.
  return { ...session, autoJoined: [] };
}

const GSI_SRC = 'https://accounts.google.com/gsi/client';

/** The sliver of the GIS API we use. */
interface GoogleIdentityApi {
  accounts: {
    id: {
      initialize(opts: { client_id: string; callback: (r: { credential: string }) => void }): void;
      renderButton(parent: HTMLElement, opts: Record<string, string | number>): void;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleIdentityApi;
  }
}

const configPromises = new Map<string, Promise<PublicConfigDTO>>();

/** Which auth options this deployment offers. Fetched once per page load;
 * a failure degrades to "no Google" rather than blocking the auth screen. */
export function publicConfig(runtime: ConnectionRuntime = activeRuntime()): Promise<PublicConfigDTO> {
  const existing = configPromises.get(runtime.origin);
  if (existing) return existing;
  const configPromise = runtime.api<PublicConfigDTO>('GET', '/v1/config').catch(
    () => ({ google: false, googleClientId: null }) as PublicConfigDTO,
  );
  configPromises.set(runtime.origin, configPromise);
  return configPromise;
}

let gsiPromise: Promise<GoogleIdentityApi> | null = null;

/** Load the GIS client script once and resolve with `window.google`. */
export function loadGoogleIdentity(): Promise<GoogleIdentityApi> {
  gsiPromise ??= new Promise<GoogleIdentityApi>((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve(window.google);
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SRC}"]`);
    const script = existing ?? document.createElement('script');
    const done = () => {
      if (window.google?.accounts?.id) resolve(window.google);
      else reject(new Error('Google Identity Services failed to initialize'));
    };
    script.addEventListener('load', done);
    script.addEventListener('error', () => reject(new Error('could not reach Google')));
    if (!existing) {
      script.src = GSI_SRC;
      script.async = true;
      document.head.appendChild(script);
    }
  });
  gsiPromise.catch(() => { gsiPromise = null; }); // let a later mount retry
  return gsiPromise;
}
