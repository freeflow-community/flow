# Multi-server sync, notification routing and parity (#542)

- `[web]` `[macos]` Keep every connected server syncing while the client runs,
  not just the one on screen — bounded start-up concurrency, per-connection
  reconnect backoff with jitter, rate-limited refreshes, and failures isolated
  to their own connection.
- `[web]` `[macos]` Aggregate switcher unread from per-connection values, so a
  server you are not looking at can say it needs you.
- `[web]` `[macos]` `[ios]` Fix a connection that nobody is showing marking its
  own arriving mentions read: a window that switches server leaves its
  `WindowState` behind, and the old session went on believing it was on screen.
- `[ios]` Resolve a push's routing identifier *before* applying its badge, and
  only honour an absolute badge from a legacy registration — a stale or unknown
  identifier could move the icon count.
- `[ios]` Reconcile the aggregated badge on foreground; no backend can compute
  it, so it is the client's sum and can only drift while suspended.
- `[server]` Add `FLOW_BUS_PREFIX` (empty by default) to namespace NATS
  subjects per deployment. Subjects key on workspace and channel id, so two
  deployments sharing a bus with *cloned* databases deliver each other's events.
- `[web]` Allow an `http://` loopback backend when the page itself is on
  plaintext loopback, not only in a Vite dev bundle — local servers ship a
  built bundle, which made multi-server untestable in a browser.
- `[qa]` `pnpm qa:up --name=<label>` runs a second independent stack, and
  `--collide` rewrites seeded ids from their natural keys so two backends
  overlap on purpose. `--allow-origin` permits a browser connection from
  another stack. Acceptance record in `docs/qa/issue-542/`.

## Feature

- **Your other servers keep up while you work.** Every connected Flow server
  stays in sync in the background, and the workspaces and servers list shows
  how much is waiting on each one — so a mention on a server you are not
  looking at still reaches you.
