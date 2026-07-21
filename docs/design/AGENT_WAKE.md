# Agent wake hooks: a doorbell for sleeping bridges (PROPOSAL)

The agent bridge (AGENTS_DESIGN.md, AGENT_MEMBERS.md) consumes events over a
live WS — which means the agent is unreachable whenever the machine running
the daemon is asleep. On a laptop that's the operator's problem, but the
natural home for a daemon is a **scale-to-zero container** (Cloud Run, Fly
machines, Railway App Sleep): cheap, always deployed, suspended when idle.
Today a DM to such an agent lands in a void — the message commits, nobody
consumes it, and the sender gets silence.

This proposal lets an agent register a **wake hook**: a webhook address the
server POSTs when a message arrives for an agent with no live connection.
The platform (or a small router) uses that request to boot the container;
the bridge then consumes the message through the normal path.

## The principle: doorbell, not mailbox

The wake call carries **no message content**. The bridge has exactly one
ingestion path — WS + REST — and the webhook's only job is to get the
container running so that path comes alive. Delivering payloads in the
webhook would build a second outbox (ordering, retries, dual ingestion) —
the thing we deliberately didn't inherit from the Slack-compat apps. Wake is
thin: fire-and-forget, throttled, idempotent by nature.

The full loop, every link of which already exists or is specced here:

```
message commits → server rings the doorbell (if agent offline)
→ platform boots the container (5–30s) → bridge connects WS
→ reconcile pulls the unread message → agent replies
```

Two prerequisites this design depends on (both valuable independently):

1. **Reconcile-on-boot** (the catch-up mechanism): after WS connect, the
   bridge fetches channels with `unreadCount > 0`, pulls messages newer than
   `lastReadMsgId`, runs them through `inScope()`, enqueues in order.
   Without it the doorbell boots the container and the message still sits
   unanswered. `ChannelDTO.lastReadMsgId`/`unreadCount` and
   `POST /v1/channels/:id/read` already exist.
2. **Token self-heal**: setup already persists `agentUsername`/`agentKey` in
   agent.json. On a 401 from `GET /v1/me`, the bridge does `POST
   /v1/agents/login`, swaps the token, continues. A scale-to-zero container
   that dies on a revoked token is a container that never wakes.

## Registration (agent self-service)

The agent sets its own hook with its own token — same posture as
`set_avatar`. New columns on the agent's user row: `wake_url`,
`wake_secret`, `wake_enabled`, `last_wake_at`, `last_wake_status`.

```
PUT /v1/me/wake     { "url": "https://…", "secret": "…", "wakeOn": ["dm", "mention"] }
GET /v1/me/wake     → { url, wakeOn, enabled, lastWakeAt, lastWakeStatus }   (secret never returned)
DELETE /v1/me/wake  → disable
```

`wakeOn` defaults to `["dm", "mention"]`, matching the bridge's default
`eventScope: "mentions"`. The server doesn't otherwise know the bridge's
scope; the agent declaring it keeps the wake decision honest. `"all"` is a
legal value, documented as chatty (v1: honor dm+mention only — see open
questions).

## The wake decision (server)

In message fan-out (where notifications are computed today), after commit:

1. **Candidates**: DM participants + mentioned users, filtered by each
   agent's `wakeOn`.
2. **Filters**: `is_agent`; `wake_enabled`; **no live WS connection** (the
   presence registry already knows); sender is not the agent itself and not
   another agent (mirrors the bridge's loop guards).
3. **Throttle**: at most one wake per agent per 2 minutes. Boot takes
   5–30s; messages arriving during the boot window are covered by
   reconcile, so extra doorbells are waste. This also makes wake naturally
   idempotent — a duplicate ring while running is a cheap 200.
4. **Fire async** (never block the message path), 5s timeout, one retry.
   Record `last_wake_at` / `last_wake_status` (HTTP code or error).

No offline-grace period: a wake fired during a deploy's reconnect blip hits
a live service and no-ops. Throttle alone suffices.

## The wake call

```http
POST <wake_url>
x-flow-signature: sha256=<hmac-sha256 of body with wake_secret>
x-flow-idempotency-key: wake-<agentUserId>-<minute-bucket>

{ "type": "agent.wake", "agentUserId": "…", "workspaceId": "…",
  "reason": "dm" | "mention", "ts": "…" }
```

Two receiver shapes, one call:

- **Dumb URL (platform-native wake).** `wake_url` is simply the service's
  public address — Cloud Run, Fly machines, and Railway App Sleep all wake
  a sleeping container on inbound HTTP. Nobody parses the body; the request
  existing *is* the signal. When the container is already up, the bridge's
  own listener answers 200.
- **Wake router (smart receiver).** A small always-on service that verifies
  the signature and starts the workload via the platform API (Fly Machines
  start, Railway resume, Lambda invoke). The signed body is what makes this
  trustworthy. This shape is also the endgame: a request-driven bridge
  runner that boots, reconciles, replies, and sleeps — serverless agents.

## Bridge changes

- New optional config block: `"wake": { "url", "secret", "listenPort" }`.
  On start, the bridge `PUT /v1/me/wake` — idempotent self-registration;
  the config is the source of truth, server state its reflection. The hook
  stays registered when the daemon stops: it exists *for* the stopped
  state. Agent removal clears it server-side, as today.
- `listenPort` set → the bridge serves `GET|POST /wake → 200` (node:http,
  no dep) so the dumb-URL shape has a live responder while up.
- **Reconcile-on-boot** (prerequisite 1) becomes part of startup.
- **Auto-`login` on 401** (prerequisite 2) makes wake→boot fully
  unattended.

## Security

`PUT /v1/me/wake` is an **SSRF surface** — any member can sponsor an agent,
and the agent's token can then aim the server's outbound POST. Mitigations:

- At write time: HTTPS only (localhost/http behind a dev flag), no
  userinfo, restricted ports.
- At fire time: reject RFC1918 / link-local / 169.254.169.254 destinations
  on the **DNS-resolved** address, not the string.
- Blast radius is small by construction (fixed JSON body; the response is
  never returned to the agent), but metadata-endpoint probes must be dead
  on arrival.
- The HMAC signature protects the receiver; the throttle protects us.

## Failure & UX semantics

- Presence stays truthful: a sleeping agent shows **offline**. The DM sends
  normally; the reply just arrives 10–30s late. The bridge sets a
  `statusText` hint at registration ("sleeps; wakes on message") — no
  client work.
- `last_wake_status` is agent-visible via `GET /v1/me/wake` and logged
  server-side; sponsor visibility in the web agents modal is an open
  question.
- **Three consecutive wake failures → `enabled = false`** with a log line
  (don't hammer a dead hook). The bridge re-enables on next start, which is
  the correct behavior after a redeploy.
- Offline with no hook registered: exactly today's behavior. Zero change
  for existing deployments.

## Alternatives considered

- **Deliver the message in the wake payload** — rejected: dual ingestion,
  ordering hazards, rebuilds the outbox. Doorbell, not mailbox.
- **Reuse the Slack-compat app outbox for wake** — considered: it's the
  mailbox model again and tied to app semantics (xoxb, event types). Wake
  reuses only the HMAC helper.
- **Platform-specific integrations** (Flow server calling the Railway/Fly
  APIs directly) — rejected: the generic signed webhook covers every
  platform via a wake router; no N-provider matrix in Flow.
- **Server-side long-poll instead of WS** — doesn't help; polling
  containers sleep too.
- **Flow-hosted runner** (the server runs CLIs itself) — a different
  product.

## Work plan (rough)

[server] migration (`users.wake_*`); the three endpoints; wake decision in
fan-out with throttle + SSRF guards; auto-disable after 3 failures. ~½ day —
bus and presence need no changes, both are readable today.
[bridge] `wake` config block; self-registration on start; `/wake` listener;
reconcile-on-boot; auto-login on 401. The reconcile is the largest piece
and ships value on its own (closes the "missed while disconnected" hole for
laptops too).
[qa] Railway service with App Sleep + `wake.url` = service domain: DM an
asleep agent, assert reply within boot+reconcile time; wake-router shape
against a stub receiver that records the signature; reconcile correctness
(threaded mentions, multi-channel backlog cap, `/reset` interaction).

## Open questions (operator rulings needed)

1. Throttle window — 2 minutes proposed.
2. Sponsor visibility/control of an agent's hook in the web agents modal
   (proposed: yes, like removal — accountability).
3. Honor `wakeOn: "all"` in v1 or ship dm+mention only (proposed: the
   latter).
4. `wake_secret` storage: plaintext (it's an outbound credential) vs hash —
   hashing is proposed since the server only signs with it.
