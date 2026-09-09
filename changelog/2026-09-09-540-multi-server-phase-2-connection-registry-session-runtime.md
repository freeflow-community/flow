# Multi-server phase 2: connection registry, session runtimes, storage isolation

- [web] [macos] [ios] Add a versioned connection registry (ServerConnection /
  ServerSession / WorkspaceBinding / NavigationTarget), provider-aware from the
  start so Slack connections need no schema change.
- [web] [macos] [ios] Give each connection its own session runtime — API client,
  socket, caches, identity — so an operation cannot be retargeted at another
  server by a later switch.
- [web] [macos] [ios] Scope every credential, cache, database, cursor, draft,
  navigation entry and read marker by connection + identity. The registry holds
  references, never credentials.
- [web] [macos] [ios] Bump an auth generation on token replacement, so a 401
  answering a pre-refresh request can no longer sign out the session that
  replaced it.
- [web] [macos] [ios] Attach the bearer only to the owning backend's exact
  origin — scheme, host *and* port — never to presigned storage URLs or
  cross-origin redirects.
- [web] [macos] [ios] Migrate the existing single connection in place on first
  upgrade: it adopts the legacy token, cache and preference slots rather than
  copying them, which makes migration crash-safe and re-downloads nothing.
- [qa] No user-facing change: one connection still exists, and add/switch UI
  arrives in phase 3.
