# Phase 18: Multi-replica readiness

> **Status: in progress — M1 started 2026-08-31.** Design:
> `docs/design/DISTRIBUTED_PRESENCE.md` (revised 2026-08-31 against current
> code — workspace-keyed presence #364, two new soft-state maps, corrected
> sweep/rate-limit inventory) — this spec schedules that work; the design
> decisions and their rationale live there and are not restated here.
> Operator ruling 2026-07-29 (`decision_log.md`): replica scaling of the
> monolith is scheduled work, overriding the 2026-07-18 scale trigger for
> this scope only; presence gossips over NATS, not Redis.

**Goal:** the `app` service runs correctly at `replicas: 2` on Railway —
availability first, capacity second.

## Scope

- **Server:** presence heartbeat/merge behind the `presence.ts` seam;
  advisory locks (boot migrations, singleton sweeps); outbox claiming with
  `FOR UPDATE SKIP LOCKED`; per-user rate limits to Postgres; Socket Mode
  delivery over a per-app NATS subject. `[server]`
- **Infra:** flip `replicas: 2` on the `app` service (dashboard/config),
  soak, verify. `[ops]`
- **Clients:** none. The wire protocol is unchanged — presence events keep
  their shape; clients never learn replicas exist.

**Out (explicitly):** the phase-4 Appendix A split (separate API/gateway
pools), JetStream, pgbouncer, NATS clustering/HA (noted in the design doc as
the new SPOF — its own decision later), distributed presence *history*
(last-seen timestamps — never scoped), per-IP rate limits moving off-process
(documented divergence, see design doc §2).

---

## Milestones

Order matters: each milestone ships alone, is invisible (or strictly safer)
at `replicas: 1`, and soaks in prod before the next starts. The flip is last
and is config, not code.

### M1 — Hard-state groundwork `[server]`

- `migrate()` under `pg_advisory_lock`; losers wait, re-check, no-op.
- `drainAppEvents` claims due rows with `FOR UPDATE SKIP LOCKED` in a short
  transaction (lease-style, delivery outside the tx — the scheduler's #419
  pattern), so two replicas draining is throughput, not double delivery.
- Daily orphan-file sweep and boot-time session purge each behind
  `pg_try_advisory_lock` — skip the round if another replica holds it.
  (Unfurl-cache expiry dropped: that sweep is unwired; see design doc §2.
  The scheduled-message scheduler needs nothing — already `SKIP LOCKED`.)
- Per-user limiter keys (`delete-me`, `join-redeem`) → Postgres fixed-window
  table; per-IP limits stay in-memory (documented divergence).
- Tests: concurrent `drainAppEvents` calls deliver each event exactly once;
  concurrent `migrate()` is serialized (two connections in-test); the DB
  limiter counts across two callers; the sweep lock admits one runner.

### M2 — Distributed presence `[server]`

- Heartbeat publish + merge + expiry + event dedup + offline-expiry
  election, per design doc §1 — **workspace-keyed** (#364): the payload
  carries per-workspace user sets. All behind `presence.ts`; the gateway and
  `<!here>` resolution keep their current imports. All four reads go merged:
  `isOnline`, `onlineUsersIn` (connect snapshot), `hasAnyConnection`
  (indicator clearing), and `sweepStale`'s offline emissions.
- The two newer soft-state maps ride along per design doc §1a: channel
  indicators join the heartbeat; the huddle roster cache syncs from the bus
  events it already publishes (decide the exact mechanism in the PR).
- Tests: two in-process "replicas" against one NATS — merged `isOnline`,
  no duplicate presence events on second-socket connect, offline emitted
  once on expiry, degradation to local view when the bus drops.

### M3 — Socket Mode routing `[server]`

- `deliverEnvelope` publishes to `app.{appId}.socketmode`; holding replica
  forwards to its local socket; app-socket liveness rides the presence
  heartbeat, per design doc §3.
- Test: envelope enqueued on replica A reaches an app socket held by B.

### M4 — The flip `[ops]` `[qa]`

- Set `replicas: 2`. Soak ≥ a few days before calling acceptance.
- QA (two browsers, forced onto different replicas by reconnecting):
  presence transitions visible both ways; `@here` resolves users on both
  replicas; a Socket Mode app receives each event exactly once; exactly one
  sweep run per day in logs; a deploy under load stays zero-downtime
  (monitor `/healthz` through the window — 2 replicas → up to 4 containers
  mid-deploy, check memory headroom first).

---

## Verification

- `pnpm -r build` and `pnpm -r test` green throughout.
- M1–M3 each soak at `replicas: 1` with no behavior change observed.
- M4 QA list above, plus: kill one replica mid-session — its users read
  online for ≤30s then flip offline exactly once; reconnected clients land
  on the survivor and backfill cleanly.

## Acceptance

- `replicas: 2` in production with the M4 QA list passing.
- No duplicate app-event deliveries and no duplicate sweep runs over the
  soak window.
- Design doc's open questions (heartbeat cadence/TTL, first-flip count)
  resolved and recorded in `decision_log.md`.
- CHANGELOG `[server]` entries per milestone; nothing in FEATURES.md
  (invisible to users by design — that invisibility is the acceptance bar).
