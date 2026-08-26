# Mini apps 2/4 — bridge: `app-guard`, and `create_artifact` can register an app

- `[bridge]` New subcommand
  `flow-agent-bridge app-guard --upstream http://localhost:3000 --port 8788`:
  a reverse proxy that only forwards requests from authenticated Flow channel
  members. Tunnel the guard's port instead of the app's and the app stops
  relying on URL obscurity.
- `[bridge]` Guard behaviour per `docs/design/MINI_APPS.md`: a `?flow_token=`
  is verified offline (HMAC, no Flow calls), its `jti` burned against replay,
  swapped for an 8-hour `flow_app_session` cookie and 302'd to the clean URL.
  Proxied requests carry `X-Flow-User-Id` / `-User-Name` / `-Artifact-Id` /
  `-Channel-Id` / `-Is-Agent`; inbound `X-Flow-*` is stripped so identity can
  only come from the session. Anything else gets a 401. WebSocket upgrades
  take the same cookie check.
- `[bridge]` `create_artifact` gains `app: true` (url only) and returns the
  one-time secret inside the `app-guard` command it belongs in — Flow never
  shows it again. `list_artifacts` renders app artifacts as `[app]`.
- `[bridge]` `FLOW_APP_SECRET` accepts several secrets (one app pinned in more
  than one channel is one artifact and one secret each). Version 0.26.0.
