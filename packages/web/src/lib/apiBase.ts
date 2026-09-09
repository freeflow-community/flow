// Where the API is. The web client is served by the API server itself (Vite
// proxy in dev, Fastify static in prod), so the default is same-origin: every
// path stays relative and the web build is byte-for-byte unaffected by this
// file. A packaged client (docs/design/ANDROID.md, phase 0) is served from its
// own origin — capacitor://localhost, https://localhost — and has to say where
// the server is. Two ways to: bake it in at build time (`VITE_API_BASE`, the
// app build), or set it at runtime (`setApiBase`, for a first-run server
// picker). The runtime value wins and persists through the client store so it
// survives a restart.
import { store } from './storage';

const STORAGE_KEY = 'flow.apiBase';

/** `undefined` = not yet read from the store; `null` = read, nothing there. */
let override: string | null | undefined;

function normalize(base: string): string {
  return base.trim().replace(/\/+$/, '');
}

/** The API origin without a trailing slash, or `''` for same-origin. */
export function getApiBase(): string {
  if (override === undefined) override = store().get(STORAGE_KEY);
  return override ?? normalize(import.meta.env.VITE_API_BASE ?? '');
}

/** Runtime override (a server picker). `null` clears it, back to the build-time
 * value. */
export function setApiBase(base: string | null): void {
  override = base ? normalize(base) : null;
  store().set(STORAGE_KEY, override);
}

/** Absolute URL for an API path such as `/v1/me`. Same-origin = the path
 * itself, which is what every caller passed before this seam existed. */
export function apiUrl(path: string): string {
  return `${getApiBase()}${path}`;
}

/** WebSocket URL for an API path. Derived from the API base when there is one
 * (http → ws, https → wss); otherwise from the page, as before. */
export function wsUrl(path: string): string {
  const base = getApiBase();
  if (base) return `${base.replace(/^http/, 'ws')}${path}`;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}${path}`;
}

/** Test seam: forget the cached override so the next read hits the store. */
export function resetApiBaseForTests(): void {
  override = undefined;
}
