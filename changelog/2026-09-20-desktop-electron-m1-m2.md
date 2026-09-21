# Desktop client (Electron): host seam and a shell that signs in and chats

- `[desktop]` New `apps/desktop`: an Electron shell that serves `packages/web/dist`
  from `app://flow` with a typed `window.flowDesktop` bridge. One window with
  restored bounds, real app menu (Edit roles, text zoom), right-click menu with
  spelling, `flow://` links on all three OSes, single instance, `FLOW_PROFILE`
  and `FLOW_SERVER_URL` as on macOS. Bearers go to the OS credential store.
  M1–M2 of `docs/specs/desktop-electron.md`; no installer, notifications or
  tray yet.
- `[web]` `lib/host.ts` is the seam: credentials, default server origin,
  external links and deep links go through the host, with a browser fallback
  that leaves browser behaviour unchanged. Google, another-server (PKCE) and
  Slack sign-in open the system browser on desktop and return by `flow://`,
  as the macOS app does; the "open the desktop app" pitches hide there.
- `[server]` The `app://flow` origin is admitted like a native client (CORS
  headers, handoff with a null client origin); `/v1/client-info` reports
  `capabilities.desktop`.
- `[bridge]` Slack connector admits `app://flow` and lets it claim the native
  `flow://slack` return.
