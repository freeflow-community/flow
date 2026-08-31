# Multi-replica readiness & distributed presence (PROPOSAL)

The operator wants the `app` service to be able to run with `replicas > 1` on
Railway — for availability first, capacity second. That pulls forward part of
the multi-node design preserved in `phase4.md` Appendix A, which was gated on
load triggers that have not fired (decision log 2026-07-18). The operator
ruling of 2026-07-29 overrides that trigger for *replica scaling of the
existing monolith only*; the larger Appendix A split (separate API and gateway
pools, JetStream, pgbouncer) stays scale-triggered and is out of scope here.

Status: proposal, scheduled as `docs/specs/phase18.md`. Nothing here is
built yet except where noted.

> **Revised 2026-08-31** against the code as it stands. What changed since
> 2026-07-29: presence is now keyed per **(user, workspace)** (#364), so the
> heartbeat payload and merge below are workspace-aware; two more presence
> consumers exist (`onlineUsersIn`, `hasAnyConnection`); the scheduled-message
> scheduler (#419) landed already replica-safe (`FOR UPDATE SKIP LOCKED`); two
> new replica-local soft-state maps exist (channel indicators #137, huddle
> roster) — see the inventory and §1a; the "unfurl-cache expiry" sweep named
> in the original §2 turned out to be unwired (`evictExpired` has no caller)
> and is dropped from scope.

## What already works at N replicas

The phase-1 seam did its job: all real-time fan-out already goes through NATS
(`bus.ts`), and every gateway is a subscriber. Any replica can serve any
user's WebSocket — no sticky sessions, no session affinity needed from
Railway's load balancer. Clients' REST backfill (and the native SyncEngine)
already covers reconnects. Messages, typing, notifications, artifacts, and
meta events need **no changes**.

## What breaks, and where

Single-node assumptions, verified in code (rows 6–7 added 2026-08-31):

| # | State | Where | Failure at N=2 |
|---|-------|-------|----------------|
| 1 | Presence map | `presence.ts` (per **(user, workspace)** connection counts, #364) | users online via replica A look offline on B; `@here` under-resolves; new sockets get a partial presence snapshot; B wrongly clears A-connected users' indicators on local disconnect (`hasAnyConnection`) |
| 2 | Boot migrations | `db/migrate.ts` (no lock) | replicas race the same migration during deploy |
| 3 | App-events outbox | `services/appEvents.ts` `drainAppEvents` (plain SELECT) | both replicas claim the same due rows → apps receive events twice |
| 4 | Socket Mode sockets | `gateway/socketMode.ts` (in-process map) | an app's socket lives on A; B's drain worker sees `hasLiveSocket() === false` and can't deliver |
| 5 | Rate limiter | `lib/rateLimit.ts` (in-memory windows) | limits are silently N× looser |
| 6 | Channel indicators | `indicators.ts` map (writers in `services/channelIndicators.ts`) | a spinner set via replica A is missing from B's channel-list snapshot; live events still reach every client (they ride the bus) |
| 7 | Huddle roster cache | `huddles.ts` map (cache of LiveKit truth) | join/leave REST and webhooks land on one replica; the other's channel-list snapshot shows a stale roster until its next boot reconcile |

Already replica-safe, no work needed: the scheduled-message scheduler (#419)
claims due rows with `FOR UPDATE SKIP LOCKED`; message/typing/notification
fan-out (NATS since phase 1); the unfurl cache (DB-backed, TTL checked on
read — its `evictExpired` housekeeping is currently unwired, and if it is
ever wired it goes behind the §2 sweep lock).

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
  `{ replicaId, workspaces: { [workspaceId]: userIds[] } }` — the full local
  online set, keyed the way `presence.ts` now keys it: per **(user,
  workspace)** (#364). Full snapshots, not deltas: self-healing by
  construction, and the payload is a few KB even at thousands of concurrent
  users. `replicaId` is per-process-boot random (Railway replicas have no
  stable identity; a restart is just a new id whose predecessor expires).
- **Merge.** Every replica subscribes to `presence.sync.*` and keeps
  `remote: Map<replicaId, { workspaces: Map<workspaceId, Set<userId>>, lastSeen }>`.
  Entries older than ~30s (3 missed beats) are dropped.
- **Read path.** All four presence reads consult local **or** any live
  remote entry, per (user, workspace) where keyed:
  - `isOnline(userId, workspaceId)` — `<!here>` resolution
    (`services/notifications.ts`);
  - `onlineUsersIn(workspaceId)` — the new-socket presence snapshot
    (`gateway/index.ts`) must union the merged sets;
  - `hasAnyConnection(userId)` — the gateway's disconnect path uses it to
    clear a user's channel indicators; without the merged view, replica B
    closing its last local socket wrongly clears indicators for a user still
    connected via A;
  - the seam is unchanged: every consumer already goes through
    `presence.ts`.
- **Event dedup.** Client-facing `presence` events must fire only on *global*
  transitions. Rule: a replica emits the workspace online/offline event only
  when a **local** socket transition changes the **merged** answer for that
  (user, workspace). Every transition originates on exactly one replica, so
  exactly one replica emits — no coordination needed. (A user already online
  via A opening a socket on B: B's local 0→1 doesn't change the merged answer
  → no event. Last socket closing on A while B still holds one: same, no
  event.) This rule covers `sweepStale` too — the gateway's half-open-socket
  TTL is just another local transition, and its offline emissions go through
  the same merged-answer check.
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

## 1a. Other replica-local soft state (added 2026-08-31)

Two maps landed after this design was written, both presence-shaped (soft,
loss-tolerant, event fan-out already on the bus; only the *snapshot* read in
`listChannels` is replica-local):

- **Channel indicators** (#137, `indicators.ts`): ride the same heartbeat —
  include each replica's live `(channelId, state)` aggregates alongside the
  presence sets, and merge on read the same way. The disconnect-clear path
  additionally needs the merged `hasAnyConnection` (§1 read path).
- **Huddle roster** (`huddles.ts`): a cache of LiveKit, which is
  authoritative and external. Cheapest fix is not gossip: each replica also
  subscribes to the huddle bus events it already publishes and applies them
  to its local cache, exactly like a client would; boot reconciliation covers
  the rest. Decide at M2 implementation time; either mechanism is behind the
  existing module seams.

## 2. Hard-state fixes (Postgres)

- **Migrations:** wrap `migrate()` in `pg_advisory_lock` — losers wait, then
  see rows already applied and no-op. Also makes overlapped zero-downtime
  deploys strictly safer at N=1.
- **Outbox:** `drainAppEvents` claims rows with `FOR UPDATE SKIP LOCKED`
  inside a transaction. Two replicas draining concurrently is then a feature
  (more throughput), not a bug.
- **Singleton sweeps** (daily orphan-file sweep, boot-time session purge):
  `pg_try_advisory_lock` per job on a dedicated connection — one replica
  wins, others skip that round. No leader election machinery. (The original
  list also named "unfurl-cache expiry"; that sweep does not actually run —
  `evictExpired` is unwired — so it is out of scope until someone wires it,
  behind the same lock.)
- **Rate limits:** the per-**user** keys (`delete-me`, `join-redeem` in
  `routes/index.ts`) move to a Postgres fixed-window counter table; these are
  the limits where one caller crossing replicas matters. The unauthenticated
  per-IP limits stay in-memory — N× looser is acceptable there and each
  request still hits a limiter; documented divergence, revisit if abuse shows
  up. (Appendix A's per-user *message write* limits were never built; nothing
  to move there.)

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
