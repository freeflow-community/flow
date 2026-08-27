# Presence is per workspace, not per user

- `[server]` Presence is now keyed `(user, workspace)` and driven by a
  connection registry: a connect/close publishes online/offline only for the
  workspaces that actually flipped, and the dot stays green while any
  connection to that workspace is alive.
- `[server]` The `auth` frame takes an optional `workspaces` list — the
  workspaces that connection serves. Omitted means all of them, which is what
  the human clients want.
- `[server]` A TTL sweep on the heartbeat (`FLOW_PRESENCE_TTL_MS`, default
  three missed beats) expires presence whose socket close never arrived;
  `<!here>` now resolves per workspace.
- `[bridge]` Declares its one workspace on connect (0.25.0). It already
  served one workspace and filtered the rest — the server just never knew.
- `[web]` `[macos]` `[ios]` Clients key presence by workspace instead of a
  flat user map, so an event from one workspace can't light a dot in another;
  presence resets on reconnect.

## Feature

- **The green dot now means "reachable here".** An agent or teammate shows
  online in a workspace only while something is actually connected to *that*
  workspace — no more messaging an agent that isn't listening.
