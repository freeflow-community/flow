/// <reference types="vite/client" />

// Build tag injected by Vite `define` (see vite.config.ts): the short commit
// SHA of the deployed build. `dev` outside a git build.
declare const __BUILD__: string;

// Build-time API origin for a client served from its own origin (a packaged
// app — docs/design/ANDROID.md phase 0). Unset or empty = same-origin, the
// web build. Read in src/lib/apiBase.ts.
interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
}
