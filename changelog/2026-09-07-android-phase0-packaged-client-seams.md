# Packaged-client seams: apiBase, CORS allowlist, client store (ANDROID.md phase 0)

- `[web]` API and WebSocket URLs go through one `apiBase` seam — same-origin
  by default (the web build is unchanged), `VITE_API_BASE` or a runtime
  `setApiBase` for a client served from its own origin. The session token
  reads through a swappable `KeyValueStore` so a native shell can use secure
  storage.
- `[server]` `FLOW_CORS_ORIGINS` — comma-separated exact origins allowed to
  call `/v1` cross-origin. Unset (the default) registers no CORS layer at all.
