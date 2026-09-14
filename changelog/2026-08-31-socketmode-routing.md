# Phase 18 M3: Socket Mode works across replicas

- `[server]` Envelope delivery routes over NATS request/reply
  (`app.{appId}.socketmode`): the outbox reaches an app's socket on whichever
  replica holds it. The request doubles as the liveness probe — no heartbeat
  staleness (decision_log 2026-08-31).
- `[server]` One-time Socket Mode tickets move to Postgres (migration 0039,
  sha256 only, single-use `DELETE .. RETURNING`) so `apps.connections.open`
  and the WebSocket upgrade may land on different replicas.
- `[qa]` `scripts/two-replica-rehearsal.mjs` — boots two real server
  processes against one postgres + NATS and verifies the cross-replica
  presence snapshot (M2), ticket redeem and envelope delivery (M3). The
  M4 pre-flight.
- `[server]` CI gains a NATS service; the routing tests skip themselves
  where NATS is unreachable.
