/// <reference types="vite/client" />

// Build tag injected by Vite `define` (see vite.config.ts): `MMDD.N` release
// number and the short commit SHA. `dev` / '' outside a git build.
declare const __BUILD__: string;
declare const __BUILD_SHA__: string;
