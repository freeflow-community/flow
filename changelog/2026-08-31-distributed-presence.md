# Phase 18 M2: distributed presence

- `[server]` Replicas gossip presence over NATS (`presence.sync.*`, 10s
  full-snapshot heartbeat, 30s expiry): every presence read — `@here`,
  connect snapshots, indicator clearing — now merges all replicas' views.
- `[server]` Presence events fire once per *global* transition; a crashed
  replica's missed offline events are emitted by an elected survivor. Dedup
  is deliberately asymmetric (see decision_log 2026-08-31).
- `[server]` Channel-indicator aggregates ride the same heartbeat; huddle
  rosters converge by replaying each other's full-roster bus events.
- `[server]` Inert at `replicas: 1` — no behavior or wire-protocol change;
  clients never learn replicas exist.
