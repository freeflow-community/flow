# Phase 4: Slack App Compatibility & Key-Rotation Tooling

**Scope:** a Slack-compatible API surface so existing Slack apps/bots can run against MyChat, plus the key-rotation backfill tooling promised in phase 1. Multi-node scaling is **not** scheduled work — per the 2026-07-18 architecture ruling it is scale-triggered; the design is preserved in Appendix A and built only when the trigger fires.

**Deployment:** same single Railway node as phase 3.

---

## 1. Slack API compatibility

**Goal (per overview: "core" compatibility, no BlockKit):** a Slack bot built against the Slack Web API + Events API works against MyChat by changing its base URL and tokens. Not in scope: BlockKit (excluded by overview — `blocks` are ignored, `text` fallback is used), slash commands, interactivity/modals, Slack OAuth app-directory install flow, socket mode.

### Apps and tokens

```sql
CREATE TABLE apps (
  id             uuid PRIMARY KEY,
  workspace_id   uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name           text NOT NULL,
  bot_user_id    uuid NOT NULL REFERENCES users(id),   -- every app gets a bot user row
  bot_token_hash bytea UNIQUE NOT NULL,                -- raw token shown once: "xoxb-" prefix kept for client-lib compat
  signing_secret text NOT NULL,                        -- for outgoing event signatures
  event_url      text,                                 -- Events API subscription endpoint
  event_types    text[] NOT NULL DEFAULT '{}',         -- e.g. {message.channels, reaction_added}
  created_by     uuid NOT NULL REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  disabled_at    timestamptz
);
```

- Apps are created by workspace owners/admins in a settings UI (name → bot token shown once). No app directory, no OAuth install handshake — MyChat is single-instance-per-workspace, so manual registration is the whole story.
- **Bot users** are real `users` rows (flagged `is_bot boolean`) so authorship, membership, mentions, and fan-out all work with zero special cases. Bots join channels like anyone (`conversations.join` or invited).

### Web API surface

Mounted at `POST /api/*`, Slack conventions honored: bearer token auth, form-encoded or JSON bodies, `{ok: true|false, error: "..."}` envelopes, Slack error strings (`channel_not_found`, `not_in_channel`, `invalid_auth`…), `Retry-After` on rate limits.

Core method set (maps ~1:1 onto existing services):

```
auth.test                                    users.list, users.info
chat.postMessage, chat.update, chat.delete   conversations.list, conversations.info
reactions.add, reactions.remove              conversations.history, conversations.replies
conversations.open        (DM upsert)        conversations.members, conversations.join
files.upload                                 users.conversations
```

### The `ts` problem (the one real impedance mismatch)

Slack identifies messages by `channel + ts` (`"1726063573.001200"`); MyChat uses UUIDv7. Mapping:

- `slack_ts` is **derived, not stored**: the UUIDv7 timestamp gives seconds + milliseconds; the remaining UUID random bits supply the fractional tail, making `ts` unique per channel and stable. A reversible encoding (`uuidv7 → ts` and an index-backed `ts → uuid` lookup via prefix range scan on the id) lives in one `slackcompat/ts.ts` module.
- `thread_ts` = the root message's `ts`, matching the existing `thread_root_id` model exactly.

### Formatting

- Slack `mrkdwn` ⇄ MyChat markdown converter in `/packages/shared` (bold/italic/strike/code/links/`<@userId>` mentions — the mention syntax already matches phase 2's storage format). Lossy edges (e.g. Slack date tokens) degrade to plain text; documented, not silently dropped.

### Events API (outgoing)

- On matching events (message posted, reaction added, member joined…), deliver Slack-shaped JSON to the app's `event_url`: `url_verification` challenge on registration, `X-Slack-Signature` v0 HMAC with the signing secret, 3s timeout, retries ×3 with backoff, auto-disable delivery after sustained failure (flag in UI).
- Delivery rides a **Postgres outbox table** (`pending_app_events`, mirroring `pending_emails`): event rows written in the same transaction as the triggering write, drained by an in-process worker with the retry/auto-disable behavior above — at-least-once, survives restarts, one fewer moving part than a broker consumer (2026-07-18 ruling).
- Bot messages don't generate events back to the app that sent them (echo suppression via `bot_user_id`), matching Slack.

---

## 2. Key-rotation backfill tooling

The phase-1 IOU. A CLI in `/packages/server` (`pnpm rotate-keys`):

- `status` — row counts per `enc_key_id` across `messages` and `files`.
- `backfill --to <keyId>` — batched re-encryption (decrypt with old key, encrypt with new, single-row UPDATE, 500-row batches, resumable via `id >` cursor, throttled). Runs against the live DB; GCM nonce is fresh per write so re-encryption is safe under concurrent reads.
- `retire <keyId>` — refuses unless `status` shows zero rows on that key.
- Runbook in `ops/key-rotation.md`: rotate data key (phase-3 table insert) → backfill → retire; master-key re-wrap procedure cross-referenced.

---

## 3. Phase 4 Cut Lines

**In:** app registration + bot users + bot tokens, Slack Web API core method set, `ts` mapping, mrkdwn conversion, Events API outgoing via Postgres outbox with signatures/retries, key-rotation CLI + runbook.

**Out (explicitly):** API/gateway process split, distributed presence, pgbouncer, Postgres-backed rate limits, JetStream (all scale-triggered — see Appendix A); BlockKit (overview exclusion), slash commands, interactivity/modals/shortcuts, Slack OAuth install flow / app directory, socket mode, incoming webhooks (post via `chat.postMessage` instead), user tokens (`xoxp-`) — bot tokens only.

**Build order:**
1. Key-rotation CLI (small, independent, pays off the phase-1 debt first)
2. Apps/bot-users schema + admin UI + token auth path
3. Web API core methods + `ts` module + mrkdwn converter (test against off-the-shelf Slack SDK clients: `@slack/web-api`, Bolt minus interactivity)
4. Events API delivery worker (`pending_app_events` outbox) + signing + retries

---

## Appendix A: Multi-node design (scale-triggered — documented, not scheduled)

**Trigger** (any one, sustained over a rolling 7 days, and only after vertical scaling of the single Railway service is maxed or cost-unreasonable): app-service CPU p95 > 70%; > 5,000 concurrent WebSocket connections; REST p95 > 500 ms or message fan-out lag > 2 s under normal traffic. Until then, nothing below is built (2026-07-18 architecture ruling; see decision_log.md).

The phase-1 seam gets exercised: one process becomes two pools.

- **Split:** `/packages/server` already separates `routes/`+`services/` from `gateway/`; build two entrypoints (`api.ts`, `gateway.ts`) and deploy as two Railway services. API pool scales on CPU; gateway pool scales on socket count. Railway routes `wss://` traffic to the gateway service, REST to the API service (separate subdomains; clients get both URLs from a `GET /v1/client-config`).
- **JetStream** (moves here from the original phase-2 plan): enabled on the `msg`/`notify`/`meta` subjects when the split happens — at-least-once delivery between API pool and gateway pool, short-window replay during gateway restarts. One stream, file storage, 24h `Limits` retention, ephemeral push consumer per gateway; clients already dedupe by message ID, so no protocol change. JetStream file storage needs the encrypted-volume baseline plus its built-in encryption at rest (events carry plaintext bodies). `typing`/`presence` stay core NATS (ephemeral by design). Until the split, REST backfill from Postgres covers reconnects — the single process needs no broker persistence.
- **Fan-out:** gateways are already NATS subscribers — any gateway can serve any user, no sticky sessions. Clients' REST backfill remains the backstop.
- **Presence becomes distributed state:** today one process knows all sockets. With a pool, each gateway publishes heartbeats (`ws.{wsId}.presence`, userId + gatewayId, 30s TTL semantics); every gateway keeps the merged map, and a user is online if *any* gateway vouches for them. Last-writer-wins, self-healing on gateway death (entries expire). No shared store needed.
- **Postgres:** pgbouncer (transaction pooling) in front of Railway Postgres; Drizzle session-state usage audited to be pool-safe. Ships *with* the split, never before — a single process with a bounded Drizzle pool doesn't need it.
- **Rate limiting:** per-user write limits move from in-memory to a Postgres-backed fixed-window counter (correct across the API pool); per-IP auth limits stay per-instance (good enough, documented). Also ships only with the split.
