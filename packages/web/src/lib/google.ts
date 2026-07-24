// Google Identity Services (phase16 §5). GIS hands the browser a signed ID
// token; we post it to /v1/auth/google and the server verifies it. Nothing
// secret lives here — an OAuth *web* client id is public by design.
import type { PublicConfigDTO } from '@flow/shared';
import { api } from './api';

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

let configPromise: Promise<PublicConfigDTO> | null = null;

/** Which auth options this deployment offers. Fetched once per page load;
 * a failure degrades to "no Google" rather than blocking the auth screen. */
export function publicConfig(): Promise<PublicConfigDTO> {
  configPromise ??= api<PublicConfigDTO>('GET', '/v1/config').catch(
    () => ({ google: false, googleClientId: null }) as PublicConfigDTO,
  );
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
