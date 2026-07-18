# Decision log

## 2026-07-18 — Phase 1 backend implementation decisions

- **Postgres host port 5442** (not 5432): the dev machine already runs a Postgres on 5432. Container-internal port is standard 5432; only the compose mapping differs. API on 127.0.0.1:8787 (local server only, per mandate).
- **Hand-written SQL migration + minimal runner** instead of drizzle-kit codegen: keeps the DDL byte-faithful to phase1.md §2 (citext, partial indexes, bytea PK) which drizzle-kit cannot express cleanly. Drizzle schema in TS mirrors it for type-safe queries; `schema_migrations` table tracks applied files.
- **Dev key management**: sealed data-key file `packages/server/.keys/data.key.json` (auto-generated at first boot, chmod 600, gitignored) as the KMS stand-in; `MYCHAT_DATA_KEY` env (base64, 32 bytes) overrides for tests/CI. Ciphertext layout: `body = ct || gcm_tag(16)`, 12-byte nonce in `body_nonce`. Verified: raw DB rows contain no plaintext.
- **Register also returns `{token, user}`** (spec only specified this for login): saves the client an immediate login round-trip; harmless superset of the spec.
- **Sliding session expiry implemented as write-when-needed**: expiry bumped to now+30d only when < 29d remain, so steady traffic costs at most one session write per day, not one per request.
- **`member.joined` event does double duty**: workspace join (invite accept, full member DTO) and channel join (`{userId, channelId, workspaceId}` with `channelId` set on the envelope). The gateway uses the latter to keep its private-channel membership cache fresh, per §3.
- **Replies to deleted roots and replies-to-replies rejected** (400) — enforces the one-level-deep thread rule at the service layer.
- **Deleted messages excluded from unread counts** (they'd otherwise inflate badges with tombstones).
- **404 (not 403) for resources in workspaces/private channels the caller can't see** — avoids leaking existence, standard practice.
- **Presence snapshot on WS connect**: new sockets receive `presence: online` events for currently-online users in shared workspaces (single-node local map is authoritative), so clients don't start blind; spec's event-only model unchanged on the wire.

## 2026-07-18 — Phase 1 macOS client decisions

- **SwiftPM package instead of a checked-in .xcodeproj** (`apps/macos/Package.swift`, executable target): buildable/testable headlessly with `swift build` / `swift test`, opens directly in Xcode. Consequence: as a bare executable there is no Info.plist, so the `myapp://` URL scheme can't be registered with LaunchServices yet — `.onOpenURL` is wired and activates once the target is wrapped in an .app bundle (phase 2/3 packaging); until then the Accept Invite sheet takes a pasted link/token.
- **Reconnect backfill pages `before=` cursors backwards until overlapping the newest local message id** — the API deliberately has only a `before` cursor, and this is the faithful reading of the spec's reconnect note.
- **Timestamps stored as ISO-8601 strings in the GRDB cache**; all ordering uses UUIDv7 ids per spec, timestamps are display-only.
- **Presence is event-driven only** (gateway sends an online snapshot on connect; no REST presence endpoint) — members render gray until events arrive.

## 2026-07-18 — Phase 2–4 drafted; overview gaps allocated

Gap analysis of overview.md vs. phase docs found features promised nowhere: Slack API compatibility, file previews, invite-to-channel, group DMs, profile editing/timezone, emoji in composer, password reset, invite emails, multi-node, key-rotation tooling. Allocation:

- **Phase 2** (still local): DMs incl. group, reactions, files + previews, mentions/notifications, channel membership mgmt, profiles, emoji picker, web client, JetStream.
- **Phase 3** (Railway single node): OAuth, all email flows (verification, invites, password reset), prod key management, workspace admin, ops hardening.
- **Phase 4** (new): Slack app compatibility, multi-node split, key-rotation backfill CLI.

Notable design decisions embedded in those drafts:

- **DM identity via `dm_key`** (sorted member IDs, unique per workspace) — upsert semantics, no duplicate DMs; adding someone to a group DM creates a new channel (Slack behavior), never mutates membership.
- **Reactions store unicode emoji only**; shortcodes are a client concern. No custom emoji.
- **Files: upload-then-attach** (`fileIds` on message send), blobs AES-GCM-encrypted with the same envelope scheme as message bodies; storage behind a `put/get/delete` interface (local dir → Railway bucket in phase 3).
- **Mentions stored as `<@userId>`** in bodies (rename-proof, and matches Slack's format ahead of phase 4). Client resolves names; server only validates membership.
- **No remote push (APNs/web push) in any current phase** — local OS notifications from running clients only; revisit after phase 3 deployment settles.
- **Phase 3 key management: master key in a Railway env secret** wrapping data keys in a `data_keys` table — accepts Railway console access into the threat model; real KMS is a drop-in later since only the unwrap step changes.
- **Email sends go through a Postgres outbox table** with an in-process worker (no lost sends, consistent with Postgres-as-truth).
- **Unverified accounts soft-gated** (can sign in; can't create workspaces or invite) rather than hard-blocked.
- **Slack compat: `ts` is derived from UUIDv7**, not stored — reversible encoding in one module. Bot users are real `users` rows (`is_bot`), so no special cases in fan-out/mentions/membership. BlockKit ignored with `text` fallback (overview exclusion). Bot tokens only, no user tokens or OAuth install flow.
- **Multi-node presence**: gateway heartbeats merged via NATS with TTL expiry — no shared store (no Redis).

## 2026-07-18 — Architecture rulings on the phase 2–4 drafts

Adjudication of the drafted phase docs against the standing mandate (single Mac → single Railway node → scale only when real; minimal cloud dependencies; simplest thing possible).

### Ruling 1: Multi-node work is scale-triggered, not scheduled

phase4.md scheduled the API/gateway process split, distributed presence, pgbouncer, and Postgres-backed rate limits as concrete sequential work. This contradicts the mandate ("no multi-node until real scale is reached") and is **overruled**.

- The multi-node half of phase 4 is **removed from scheduled work**. Phase 4 is now Slack app compatibility + key-rotation CLI only, deployed on the same single Railway node as phase 3.
- The multi-node design (process split via `api.ts`/`gateway.ts` entrypoints, NATS-heartbeat distributed presence, pgbouncer, Postgres-backed rate limits) is **kept as a documented design appendix** — the phase-1 seam that makes it possible stays, and the design is sound. It is documented, not built.
- **Trigger (any one, sustained over a rolling 7 days, and only after Railway vertical scaling of the single service has been maxed or become cost-unreasonable):**
  1. app-service CPU p95 > 70%, or
  2. concurrent WebSocket connections > 5,000, or
  3. REST p95 latency > 500 ms or message fan-out lag > 2 s under normal traffic.
- pgbouncer and Postgres-backed rate limiting ship **with** the split (they solve multi-instance problems), not before. A single process with a bounded Drizzle pool needs neither.

### Ruling 2: Email delivery granted as a narrow cloud exception

Transactional email cannot be sensibly self-hosted (deliverability, SPF/DKIM, IP reputation — running our own MTA is *more* complex, which the simplicity rule forbids). **Exception granted** for email delivery, under constraints:

- The contract is the plain-SMTP-shaped interface already drafted: one `send(to, subject, text[, html])` behind the `email/` module. **No provider-specific features** — no Resend templates, webhooks, analytics, or SDK types leaking past the module boundary. Any SMTP provider must be a config-only swap.
- Resend is approved as the first concrete provider; the SMTP fallback driver must exist from day one (that is the proof the interface is honest).
- **Local dev and tests never call a cloud email API**: the outbox drains to a console/log driver (or Mailpit) locally.
- The Postgres `pending_emails` outbox stands as drafted — consistent with Postgres-as-truth.

The cloud-exception list is now: Postgres, Redis (as needed), blob storage/CDN, **transactional email delivery**.

### Ruling 3 (simplicity pass): JetStream cut from phase 2

Phase 2 runs API + gateway **in one process on one machine**; NATS is an in-process seam there. JetStream persistence + a 24h replay window + JetStream encryption-at-rest config buys nothing the existing reconnect path (REST backfill from Postgres, the source of truth) doesn't already give, and its main stated justification was the phase-4 multi-node pool — now scale-triggered (Ruling 1).

- JetStream is **removed from phase 2** and moved into the same scale-triggered appendix as multi-node (it is a prerequisite of the gateway pool, so it activates with the same trigger).
- Phase 4's Events API delivery worker uses a **Postgres outbox table** (mirroring `pending_emails`) instead of a JetStream durable consumer — same at-least-once/survives-restart properties, one fewer moving part, consistent with the outbox pattern already adopted.

### Ruling 4 (simplicity pass): Sentry removed from phase 3

Sentry is a cloud service outside the exception list, and at single-node/early-user scale, pino structured logs through the Railway log drain are sufficient for the server; clients log locally. **Cut from phase 3.** If client-side crash visibility becomes a real operational need post-launch, request an explicit exception then (it would likely be granted — but as a deliberate decision, not a default).

### Ruling 5 (simplicity pass): production-hardening creep trimmed from phase 2

Minor scope drift in the local-only phase: the per-user upload rate limit moves to phase 3 (where all other rate limiting lives), and orphaned-file GC needs no scheduled-job infrastructure — a boot-time (or daily in-process timer) sweep of unattached files older than 24h is enough at this scale.
