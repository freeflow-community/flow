# Multi-replica readiness & distributed presence (PROPOSAL)

The operator wants the `app` service to be able to run with `replicas > 1` on
Railway — for availability first, capacity second. That pulls forward part of
the multi-node design preserved in `phase4.md` Appendix A, which was gated on
load triggers that have not fired (decision log 2026-07-18). The operator
ruling of 2026-07-29 overrides that trigger for *replica scaling of the
existing monolith only*; the larger Appendix A split (separate API and gateway
pools, JetStream, pgbouncer) stays scale-triggered and is out of scope here.

Status: proposal. Nothing here is built yet.

## What already works at N replicas

The phase-1 seam did its job: all real-time fan-out already goes through NATS
(`bus.ts`), and every gateway is a subscriber. Any replica can serve any
user's WebSocket — no sticky sessions, no session affinity needed from
Railway's load balancer. Clients' REST backfill (and the native SyncEngine)
already covers reconnects. Messages, typing, notifications, artifacts, and
meta events need **no changes**.

## What breaks, and where

Five single-node assumptions, verified in code:

| # | State | Where | Failure at N=2 |
|---|-------|-------|----------------|
| 1 | Presence map | `presence.ts` (userId → local socket count) | users online via replica A look offline on B; `@here` under-resolves; new sockets get a partial presence snapshot |
| 2 | Boot migrations | `db/migrate.ts` (no lock) | replicas race the same migration during deploy |
| 3 | App-events outbox | `services/appEvents.ts` `drainAppEvents` (plain SELECT) | both replicas claim the same due rows → apps receive events twice |
| 4 | Socket Mode sockets | `gateway/socketMode.ts` (in-process map) | an app's socket lives on A; B's drain worker sees `hasLiveSocket() === false` and can't deliver |
| 5 | Rate limiter | `lib/rateLimit.ts` (in-memory windows) | limits are silently N× looser |

## The principle: soft state gossips, hard state locks

Presence is ephemeral and loss-tolerant — it may be briefly wrong, never
durably wrong. That class of state rides the bus we already have. Everything
else on the list is *correctness* state (exactly-once delivery, exactly-one
runner) — that class belongs to Postgres, which we also already have.

**Redis was considered and rejected** for presence. It buys an authoritative
shared view, but at the cost of a new Railway service, client library, and
failure mode — and if Redis is down, presence needs a local fallback, which is
the gossip design anyway. The hot paths (`@here` resolution,
snapshot-on-connect) would want a local cache regardless — also the gossip
design. Nothing else on the list needs Redis either (Postgres covers it), so
presence alone can't justify the dependency. Revisit only if a future feature
independently wants Redis (hot cache, distributed queue); the seam below makes
that migration cheap.

## 1. Distributed presence over NATS

Each replica keeps its local `online` map exactly as today, and additionally:

- **Heartbeat.** Every ~10s, publish `presence.sync.{replicaId}` carrying
  `{ replicaId, userIds: [...] }` — the full local online set. Full snapshots,
  not deltas: self-healing by construction, and the payload is a few KB even
  at thousands of concurrent users. `replicaId` is per-process-boot random
  (Railway replicas have no stable identity; a restart is just a new id whose
  predecessor expires).
- **Merge.** Every replica subscribes to `presence.sync.*` and keeps
  `remote: Map<replicaId, { userIds: Set, lastSeen }>`. Entries older than
  ~30s (3 missed beats) are dropped.
- **Read path.** `isOnline(userId)` = local count > 0 **or** any live remote
  set contains the user. The new-socket presence snapshot
  (`gateway/index.ts`) and `<!here>` resolution
  (`services/notifications.ts`) read this merged view. The seam is unchanged:
  both consumers already go through `presence.ts`.
- **Event dedup.** Client-facing `presence` events must fire only on *global*
  transitions. Rule: a replica emits the workspace online/offline event only
  when a **local** socket transition changes the **merged** answer. Every
  transition originates on exactly one replica, so exactly one replica emits —
  no coordination needed. (A user already online via A opening a socket on B:
  B's local 0→1 doesn't change the merged answer → no event. Last socket
  closing on A while B still holds one: same, no event.)
- **Failure modes.** Replica crash: its users read online for ≤30s, then
  expire — acceptable for presence. NATS outage: replicas degrade to their
  local view (exactly today's behavior); fan-out is down anyway, so presence
  staleness is not the headline problem. Replica boot: merged view completes
  within one heartbeat period.
- **Offline-event gap.** When a replica dies, its users' `offline` events are
  never emitted. On expiry of a remote entry, the surviving replicas compute
  which users dropped out of the merged view; the replica with the
  lexicographically-smallest live `replicaId` emits the offline events —
  cheap deterministic election, worst case a duplicate event, which clients
  already tolerate (presence events are idempotent state, not a stream).

At `replicas = 1` all of this degenerates to today's behavior, so it can ship
and soak in prod before the flip.

## 2. Hard-state fixes (Postgres)

- **Migrations:** wrap `migrate()` in `pg_advisory_lock` — losers wait, then
  see rows already applied and no-op. Also makes overlapped zero-downtime
  deploys strictly safer at N=1.
- **Outbox:** `drainAppEvents` claims rows with `FOR UPDATE SKIP LOCKED`
  inside a transaction. Two replicas draining concurrently is then a feature
  (more throughput), not a bug.
- **Singleton sweeps** (orphan-file sweep, session purge, unfurl-cache
  expiry): `pg_try_advisory_lock` per job — one replica wins, others skip
  that round. No leader election machinery.
- **Rate limits:** per-user write limits move to a Postgres fixed-window
  counter table (per Appendix A). The unauthenticated per-IP limits may stay
  in-memory — N× looser is acceptable there and each request still hits a
  limiter; documented divergence, revisit if abuse shows up.

## 3. Socket Mode routing over NATS

An app's Socket Mode WS lives on one replica; delivery must reach it from any
replica. The socket-holding replica subscribes to `app.{appId}.socketmode`
and forwards envelopes to its local socket; `deliverEnvelope` publishes there
instead of calling in-process. Liveness (`hasLiveSocket`) becomes
presence-shaped: the holding replica includes its app socket ids in the same
heartbeat, and the outbox worker consults the merged view to pick socket vs
HTTP delivery. Ack semantics stay as today (delivery is already best-effort
with the outbox as the retry backstop).

## Phasing

1. **Replica-safety groundwork** — migrations lock, outbox `SKIP LOCKED`,
   sweep locks, rate-limit decision. Invisible at N=1; ship first.
2. **Distributed presence** — heartbeat/merge/expiry + event dedup behind the
   `presence.ts` seam. Soaks harmlessly at N=1.
3. **Socket Mode routing** — per-app subject + liveness in the heartbeat.
4. **Flip `replicas: 2`** and soak. QA: presence seen across two browsers
   pinned to different replicas (connect/disconnect both directions), `@here`
   resolution, no duplicate app-event deliveries, one-and-only-one sweep run
   per day, migrations under a rolling deploy.

Railway notes for the flip: replicas multiply the deploy-overlap container
count (2 replicas → up to 4 containers mid-deploy — check memory headroom),
and single-instance NATS graduates from implementation detail to the
service's true SPOF; its hardening belongs on the same someday list as the
Appendix A split.

## Open questions (operator)

- Heartbeat cadence / expiry (10s / 30s proposed) — tighter costs bus
  chatter, looser lengthens the crash-staleness window.
- Target replica count for the first flip (2 proposed).
