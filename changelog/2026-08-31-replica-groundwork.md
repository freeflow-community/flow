# Phase 18 M1: multi-replica hard-state groundwork

- `[server]` Boot migrations now serialize under a Postgres advisory lock —
  two replicas deploying at once can no longer race the same migration.
- `[server]` The app-events outbox claims due rows with `FOR UPDATE SKIP
  LOCKED` plus a short lease, so concurrent drains (same or another replica)
  deliver each event exactly once.
- `[server]` Daily orphan-file sweep and boot purge run on at most one
  replica per round (`pg_try_advisory_lock` on a dedicated connection).
- `[server]` Per-user limiter keys (`delete-me`, `join-redeem`) count in a
  shared `rate_limit_windows` table; per-IP limits stay in-process
  (documented divergence, design doc §2).
- `[server]` Design doc + phase 18 spec revised against current code:
  workspace-keyed presence (#364), two newer replica-local soft-state maps,
  corrected sweep/rate-limit inventory.
- Invisible at `replicas: 1` by design; no behavior change until the flip.
