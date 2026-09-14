# Local dev tooling: QA stack, cross-client compile check, push simulator

- `[qa]` `pnpm qa:up` / `pnpm qa:down` — a throwaway server on a free port with
  its own database, the standard fixtures, and a pre-authed link into every
  client. `qa:down` removes only what `qa:up` recorded creating.
- `[qa]` `scripts/check-clients.sh` compiles macOS and iOS together, so a
  shared-source signature change that only breaks the other platform (PR #465)
  fails in seconds locally instead of minutes in CI.
- `[qa]` `scripts/push-sim.sh` fires a real APNs payload at a booted simulator
  across the foreground/background/cold matrix, built by the drain's own
  `buildPushPayload` — or replayed verbatim from the dev push outbox.
- `[macos]` `LiveAPITests` take the server address from `FLOW_TEST_SERVER_URL`
  (default unchanged), and skip rather than fail when nothing Flow-shaped
  answers — 8787 is held by an unrelated app on the build Mac, which failed
  `swift test` in #455 and #459 for reasons unrelated to the code.
- `[qa]` `scripts/new-changelog.sh <ref> "<title>"` scaffolds this file, with
  the client-impact checklist ready to paste.
- `[qa]` `docs/dev/TOOLS.md` documents all five; `CONTRIBUTING.md` points at it.
