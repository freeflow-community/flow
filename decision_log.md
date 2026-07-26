# Decision log

## 2026-07-26 — A badge number always means notifications (operator ruling)

- **A number on a sidebar row counts unread *notifications*, never unread
  messages.** The two were conflated: a channel showed "12" because twelve
  people had talked in it, which trains you to ignore the number — the same
  glyph meant "you were mentioned" in one row and "a conversation happened" in
  another. A count now answers exactly one question everywhere it appears
  (channel row, Activity row, dock/app-icon badge): *how many things need me?*
- **Unread messages only embolden the row.** Bold answers the other question —
  *is there anything new in here?* — and that is all it answers. Ruled while
  testing #63, where a channel badge incrementing on a mention addressed to a
  different user made this ambiguity concrete.
- **DMs keep their numbers, and get them for free**: every message in a DM
  already raises a notification, so the DM badge is a notification count with
  no special case. A muted DM (`notify_level = 0`) writes no rows, so it goes
  bold without a number — correct, and the one place the two counts visibly
  diverge.
- The message count is still tracked and still shipped as
  `ChannelDTO.unreadCount`; it just never renders as a number. Per-channel
  notification counts sum to the Activity total (asserted in the test suite).

## 2026-07-24 — Phase 16: what "open this workspace to my domain" actually trusts

- **We trust Google's `email_verified`, not domain ownership.** Turning on
  domain self-registration for `acme.com` requires someone who already holds a
  Google account Google says is verified on `acme.com` — that is the whole trust
  anchor. We do **not** do DNS/TXT verification that the workspace owner
  controls the domain. The risk this accepts is a rogue employee opening *their
  own company's* workspace to all their colleagues; it is not a path for a
  stranger to open someone else's domain. Ruled acceptable for this phase; DNS
  verification is the upgrade if a customer needs it.
- **Consumer-domain denylist is mandatory, not advisory.** `gmail.com`,
  `outlook.com`, `yahoo.com`, `icloud.com` and friends can never be set. Without
  it "anyone with a gmail" is the entire internet, and the toggle stops being a
  domain rule and becomes open registration.
- **`hd` hardening on by default.** Beyond owning a verified address on the
  domain, the setter's Google account must be a **Google Workspace** account on
  it (the ID token's `hd` claim). This blocks a personal Gmail that merely
  *spells* a corporate address. `FLOW_GOOGLE_REQUIRE_HD=0` relaxes it for an org
  on a custom domain without Google Workspace — the denylist still stands there.
  Enforced when *setting* the domain, not on each enrolling sign-in: the setter
  is the party making the trust decision.
- **ID-token flow, not auth-code.** GIS hands the browser a signed JWT and the
  server verifies it statelessly — no client secret, no redirect URI, no
  server-side exchange. The auth-code flow only earns its complexity if we need
  Google *refresh* tokens to call Google APIs on the user's behalf (calendar,
  directory), which we don't. `GOOGLE_CLIENT_SECRET` is read but unused, so
  adding that later isn't a redesign.
- **Never merge a human Google login into a service account.** A Google email
  matching a bot or agent user is refused (`409 email_reserved`) rather than
  linked.

## 2026-07-24 — Phase 15 update: invite codes replace device-code pairing

Supersedes the sponsor-email + approval parts of the 2026-07-23 Phase 15
rulings below (the four-answer setup and harness=runtime.kind rulings still
hold; "sponsor email" is no longer one of the answers).

- **One-time invite code, not email + approval.** The sponsor generates a code
  inside Flow (**Invite your Agent** → mints on open); the agent redeems it with
  `npx flow-agent-bridge <code>`. The code carries the sponsor + workspace, so
  there is no sponsor-email lookup and no approval popup — redeeming the code IS
  the authorization. Rationale: the approve-a-matching-code dance was the most
  confusing part of onboarding; a copy-paste code the sponsor already trusts is
  simpler and removes a whole real-time surface.
- **Immediate join; random avatar.** Redemption creates the agent and joins it
  synchronously (workspace + `#general`, usual join notice). The avatar is a
  random preset the sponsor can change in-app afterwards — no picker at
  onboarding. The bridge still asks name/handle/harness.
- **Single-use, 7-day TTL, hashed.** Each code redeems once (conditional update
  on `redeemed_at`), expires after `inviteTtlDays` (7), and is stored only as a
  sha-256 hash. The raw code (`flow-XXXX-XXXX` — two groups of 4 over a
  no-confusables uppercase alphabet, ~40 bits) is shown once. Deliberately short
  and readable at the cost of guessability (operator ask 2026-07-24); the
  single-use + expiry + rate limit are what actually bound abuse. Any workspace
  member can mint one (same "any member can sponsor" ruling as before).
- **Device-code flow deleted, not deprecated.** `agent_pairing_requests` is
  dropped (migration `0022`), along with the `agent.pairing` event, the
  register/poll/approve/deny + `agent-avatars` routes, the web
  `AgentPairingPrompt`, and the bridge `register` subcommand. The
  username+key **login** recovery path is kept (unchanged). Superseding a spec
  is cheaper than carrying two onboarding flows.

## 2026-07-23 — Phase 15 (Invite your Agent) rulings

- **Four required setup answers, everything else via flags.** `npx
  flow-agent-bridge` first-run setup prompts only for agent name, handle, sponsor
  email, and harness — asked up front, then registration runs. Server URL, an
  existing token to reuse, description, and working directory are optional flags
  with defaults (cwd defaults to the directory the command ran in, so the repo you
  invoke it from becomes the agent's identity with zero questions). With all four
  required values passed as flags the flow is non-interactive, so it works over
  SSH / in a script / from a Dockerfile.
- **Harness = runtime kind.** The "harness" prompt maps to the existing
  `runtime.kind` (`claude` / `codex` / `demo`). The dialog copy names OpenCode as
  an example agent because the bridge is harness-agnostic ("prompt in, text out"),
  but OpenCode isn't yet a first-class runtime kind — it would run via a `command`
  override, not by picking it at setup.
- **The dialog's popup "screenshot" is a live static mock, not an image.** The
  spec asked for a screenshot of the pairing popup; instead the dialog renders a
  non-interactive React copy of `AgentPairingPrompt` (same layout, placeholder
  data). It stays theme-correct and can never drift from the real prompt the way a
  checked-in PNG would.
- **The CTA is web-only for now.** The button + dialog ship on web; native
  clients don't get them. This is tracked as a Parity gap that closes with the
  broader native agent-pairing work (the approval prompt is itself a web-only
  surface today), not as its own separate task.

## 2026-07-22 — Unfurling does not consult robots.txt

Phase 11 §3 says to fetch robots.txt per origin and honor `Disallow` for our
bot UA and `*`. Implemented as specced, and the first real link a human pasted
(an Instagram post) produced no card: Instagram's robots.txt ends with
`User-agent: *` / `Disallow: /`, whitelisting only named crawlers (Amazonbot,
ClaudeBot, GPTBot…). The same is true of X, Facebook and most large social
sites — precisely the links people most want previewed. Slack gets these
because publishers whitelist `Slackbot-LinkExpanding` by name; a new service
has no such standing, and §11 puts authenticated/oEmbed-token unfurls out of
scope for v1.

Ruling (operator): **robots.txt is not consulted for unfurls.** The rationale
is that robots.txt governs bulk crawling, whereas an unfurl is a single fetch
of a URL a user explicitly pasted into a conversation — closer to the user's
own browser following the link than to a crawler.

Deviation from spec §3, taken knowingly. Risks accepted: this is not what
Slack's own bot does, and a site may block or rate-limit our egress IP.

The robots parser/cache is **kept, not deleted**, behind
`FLOW_UNFURL_RESPECT_ROBOTS=1` (default off) — that env var is the lever to
pull if egress starts getting blocked, and it restores spec behaviour exactly.

## 2026-07-21 — @-mentioning a non-member of a channel

Surfaced live: @-mentioning an agent that wasn't a member of the channel did
nothing (the agent-bridge only responds to mentions in channels it has joined),
with no on-screen hint — on macOS there was no feedback at all.

Ruling (operator): the @-typeahead **keeps listing every workspace member** —
it is not narrowed to channel members. Instead, when a sent message @-mentions
someone who isn't in the (standard) channel, the composer **prompts to invite
them** ("… isn't in this channel and won't see your mention" + "Add to
channel"). This is the web's existing behavior; the ruling extends it to macOS.
Re-mention after adding — the original mention isn't delivered retroactively
(and an agent never processed it). iOS still lacks the CTA (separate composer;
tracked in CHANGELOG Parity).


## 2026-07-21 — On-demand agent registration with human sponsors

Operator ask: replace the admin invite-key flow — every agent gets a
responsible human **sponsor**, registration looks like human registration
(username + key + bot name), and it happens on demand: the agent registers
naming its sponsor's email, the sponsor synchronously approves a matching
pairing code inside Flow. Spec-first: AGENT_MEMBERS.md was rewritten before
the implementation; this change makes it true.

Rulings (operator-approved recommendations):

- **Any member can sponsor** — no admin involvement, matching the intent; a
  workspace-level permission knob can be added later if needed.
- **Username + key are durable credentials** (argon2-hashed like passwords).
  `POST /v1/agents/login` re-mints the agent token (revoking prior ones), which
  replaces both "Regenerate token" and admin recovery, and doubles as rotation.
- **Workspace is chosen at approval time**, not in the register call — the
  agent can't know workspace ids and the sponsor's email doesn't disambiguate.
- **Anti-enumeration**: the register response never reveals whether the
  sponsor email matched; unmatched requests just expire. The endpoint is
  rate-limited per IP (it triggers a user-visible prompt).
- **Token delivered on exactly one poll** (guarded by `token_delivered_at`);
  a lost delivery is recovered via login, so the raw token is never stored.
- **Sponsor departure cascades**: removing a sponsor from a workspace removes
  the agents they sponsor there — orphaned agents would recreate the
  accountability gap sponsorship exists to close. Agent removal (admin OR
  sponsor) also nulls username/key so removed agents can never log back in.
- **Old flow retired destructively**: `agent_invites` dropped in
  `0015_agent_pairing.sql` (consumed single-use invites, no live value);
  pre-existing agents keep working on their tokens with `sponsor_user_id NULL`.
- **Pairing code alphabet** excludes 0/O/1/I/L confusables (`XXX-XXX`) — the
  human eyeball-match of the code across two screens is the security handshake.

## 2026-07-21 — Delete a user when removed from their last workspace

Operator ask: when an admin removes a user and it was that user's last
workspace, "completely delete" the user — motivation being to free up an email
address (`scottp@berkeleyzone.net`) to run through the invite/registration flow
again.

Rulings:

- **Tombstone, not hard delete.** `messages.user_id` (and `channels.created_by`,
  `invites.invited_by`, `files.user_id`, `workspaces.created_by`) reference
  `users.id` with **no cascade**, and `memberRemoval.ts` deliberately keeps the
  user row so authored messages keep their name. A literal `DELETE FROM users`
  would fail the moment the person ever posted. So removal on the last workspace
  sets `users.deleted_at`, keeping the row and its message authorship intact.
- **Free the email by rewriting it, not by a partial unique index.** The address
  is freed by mangling the tombstoned row's `email` to `tombstone+<id>+<email>`
  (original preserved for audit, uniqueness guaranteed by the id prefix). This
  leaves the single `UNIQUE(email)` index and every `where(email = …)` lookup in
  `auth.ts` (register/login/forgot/signin) untouched — a tombstone simply can't
  be found by its old address, so re-registration inserts a fresh row. Chosen
  over swapping in a `WHERE deleted_at IS NULL` partial index, which would have
  forced a `deleted_at IS NULL` filter into all of those queries.
- **Humans only.** The tombstone runs only through `removeMember` (the admin
  panel path) and is additionally guarded by `!isBot && !isAgent`. Bots/agents
  keep their `deleteApp` / `removeAgent` lifecycles; tombstoning their user row
  would orphan `apps` / `agent_tokens`.
- **Atomic with the removal + full credential wipe.** The tombstone runs inside
  `removeMemberDeep`'s transaction via its `also(tx)` hook, after the
  workspace-membership row is deleted, so "last workspace" is decided race-free.
  It also scrubs the password to a sentinel and deletes sessions, email tokens,
  and app-link codes so nothing the account held can still authenticate.
- **Owner caveat (unchanged):** the workspace owner can't be removed, so a sole
  owner is never tombstoned through this path — reassign/transfer would be a
  separate feature.

## 2026-07-21 — Admin panel to manage users (build decisions)

Operator answers (AskUserQuestion) that scoped the feature:

- **Web only.** Consistent with the existing App and Agent management UIs
  (operator ruling 4). The server endpoints are platform-neutral, so a macOS
  UI can follow later; tracked as a deliberate divergence in CHANGELOG Parity.
- **Actions: change roles + remove from workspace.** (Invite already exists.)

Design rulings made during the build:

- **The admin page is a virtual, client-only sidebar entry, not a real
  channel.** It reuses the channel-selection machinery via a sentinel id
  (`ADMIN_VIEW_ID = '__admin__'`); the content pane branches on it to render
  `<AdminView>`. This gives channel-like selection/active-highlight for free
  without inventing a new view-routing concept.
- **"Closable like any other channel" = a per-device UI hide.** Flow has no
  "close but stay joined" for real channels — only Leave (drops membership) and
  Archive (workspace-wide). Since the admin entry has no membership, its close
  (hover ✕) just unpins the row (persisted in `localStorage`); reopen from the
  workspace menu. If we ever want hide-but-stay-joined for real channels/DMs it
  needs a new `channel_members.hidden_at` column + filter — deliberately not
  built here.
- **Permission model:** owner/admin may change roles and remove members. The
  `owner` role is immutable and unassignable through this surface, the owner
  can't be removed, and an actor can't change/remove themselves (no accidental
  self-lockout). Any admin may act on any non-owner (Slack restricts admins
  from touching other admins; kept simpler here — revisit if operators object).
- **Live sync:** role changes broadcast a new `member.updated` event on the
  workspace meta subject; clients refetch members + workspaces so a demoted
  admin's own menu gating updates. Removals reuse `removeMemberDeep`'s existing
  `member.left` cascade.

## 2026-07-21 — 500 MB file cap (operator-directed; sizing decisions pending review)

Operator: "shared videos will often be up to 200 MB or more." Decisions made
in implementation:

- **Direct-upload cap 500 MB** (`FLOW_MAX_FILE_MB` env to tune): comfortable
  headroom over the stated 200 MB without inviting abuse; only the presigned
  path gets it — bytes stream to R2, the server never holds them.
- **Server-buffered paths keep 20 MB** (`maxServerUploadBytes`): legacy
  multipart, Slack-compat `files.upload`, avatars all buffer whole files in
  app-server memory, so raising them would be an OOM footgun. Big files must
  use the presign flow (all first-party clients do).
- **Thumbnail sidecar capped at 32 MB source size**: complete-time
  thumbnailing GETs the whole object; a 200 MB "image" would OOM the server.
  Larger images upload fine, just render as chips.
- **Streaming endpoint TTL 1 h** (`GET /v1/files/:id/url`): long enough to
  watch a feature-length video with seeking; web re-mints once on error. The
  5-minute TTL stays for download 302s.
- **Web streams; native still downloads-then-plays** — recorded as a Parity
  gap (native fix is AVPlayer on the presigned URL), but native up/downloads
  now stream disk↔network instead of staging in RAM.

## 2026-07-20 — R2 blob storage + presigned direct upload/download (operator rulings)

Pre-flight answers (AskUserQuestion) for the Cloudflare R2 phase:

- **App-layer encryption is dropped for R2-era file blobs.** Direct-to-R2
  presigned upload/download means the server never touches the bytes, so
  AES-256-GCM envelopes can't survive. Posture: R2 encrypts at rest, every
  URL is short-lived (PUT 15 min / GET 5 min) and minted only after the
  existing access checks. `files.enc_key_id` NULL marks plaintext blobs;
  legacy rows keep decrypting through the keyring until migrated. Message
  bodies remain encrypted — this ruling covers file/thumb/avatar blobs only.
- **Downloads also go direct**: `GET /v1/files/:id` (and `/thumb`) 302-redirect
  to a presigned R2 URL after the access check. R2 serves Range requests
  (video seeking) natively. On the local driver the server proxies as before.
- **All three clients (web, macOS, iOS) switch to presign→PUT→complete in this
  phase** — parity stays clean. The multipart endpoint keeps working (now
  writing plaintext) for un-upgraded clients and the Slack-compat surface.
- **Everything on the Railway volume migrates to R2** (decrypt-and-copy at
  boot behind `FLOW_MIGRATE_BLOBS=1`; volume kept as rollback safety net until
  prod verification, then droppable). Uploads size-bind via the signature:
  content-length/type are signed headers, so the 20 MB cap holds even though
  the server never sees the upload.
- Local dev keeps the disk driver with a server-proxied fallback
  (`PUT /v1/files/:id/content`) behind the same client code path, so dev needs
  no R2 credentials and clients have no driver awareness.

## 2026-07-20 — First-class AI agents: build decisions (PM rulings, pending operator review)

Implementation decisions made while building AGENTS_DESIGN.md; the design's
own operator rulings are recorded in that file.

- **Agent token format `flow-agent-token-<token>`**, distinct from the invite
  key's spec-mandated `flow-agent-<token>` — the two credentials look
  different, so a pasted-wrong one fails obviously. Auth is still a pure hash
  lookup (prefix is cosmetic).
- **`description` at register is stored as the agent's `statusText`**
  (truncated to 80): users have no bio field, and the status line renders
  everywhere already — an agent's purpose shows up exactly where a human's
  status would. `avatarUrl` stores as given (external URLs may not render in
  every client, which only fetch `/v1/avatars/*`).
- **Role guard implementation**: agents are created role `member` and the only
  path to owner/admin in the codebase is workspace creation (there is no
  role-change endpoint), so `createWorkspace` is closed to agents; everything
  admin-gated (invites, apps, agents) already excludes plain members.
- **`deleteApp` refactored onto a shared `removeMemberDeep`**
  (services/memberRemoval.ts) rather than copying its body into remove-agent —
  same transaction shape and identical member.left event sequence, one place.
- **Bridge config is JSON only** (`agent.json`) — the spec allowed
  "agent.toml or JSON"; Node has no stdlib TOML parser and the config is
  small. Documented in AGENTS.md.
- **The `flow` MCP stdio server is hand-rolled** (newline-delimited JSON-RPC,
  ~150 lines) instead of depending on the MCP SDK — four tools, no dynamic
  capabilities, one less dependency. Verified against the real claude CLI
  (tools/list + tools/call round-trip).
- **`search_history` filters client-side** (fetch last 200 channel messages,
  case-insensitive substring): /v1 has no search endpoint; good enough for the
  v1 tool contract without growing the server surface.
- **`respondToAgents: false` by default** (bridge): sender gating per spec
  plus an agent-to-agent ignore, closing the two-bridges-DM-each-other
  infinite loop. Opt-in flag for deliberate agent pipelines. (App-bot senders
  can't be detected — member DTOs don't expose isBot — noted gap.)
- **macOS/iOS badge via display-name maps** (`displayNameWithBadge`): the
  clients thread flat id→name maps everywhere, so agent names carry " 🤖" in
  those maps. Side effect: mention pills and typing labels also show the
  badge (display-only; outgoing mention resolution and accessibility ids use
  plain names from the DB). Web keeps plain `useNameMap` + a separate
  `useDisplayNameMap`, badge-free testids.
- **Web "member list" surface**: web has no standing member panel, so the
  admin **Remove agent** action lives in the Agents modal (with the invite
  flow), mirroring how app removal lives in the Apps modal.
- **Claude CLI variadic flags** (`--mcp-config`, `--allowedTools`) are passed
  as `--flag=value` — the space form swallows the positional prompt (found in
  the real-CLI round-trip check).

## 2026-07-19 — Socket Mode compatibility (operator-requested, for local bots)

Built to run the operator's existing Socket-Mode Slack bots against production
Flow without public endpoints or tunnels. Key rulings:

- **Transport only, outbox stays authoritative**: the socket is a delivery
  path for the existing `pending_app_events` outbox (live socket preferred,
  verified eventUrl fallback) — no separate queue, at-least-once preserved.
  Ack = the client's `{envelope_id}` echo.
- **Offline socket-only apps drop events after the normal retry window**
  (matches Slack) but are **never auto-disabled** — auto-disable exists to
  stop hammering dead HTTP endpoints; applying it to a restarting bot would
  turn a redeploy into an outage.
- **App-level token minted at creation** alongside the bot token (same
  hashed/one-time policy). No scopes — it only opens sockets.
- **One-time 60s connection tickets, in-memory** (single-node, like presence);
  reconnects just call `apps.connections.open` again.
- **Both WS endpoints route through one upgrade router** — `ws` servers with
  `{server, path}` abort every non-matching upgrade, so two of them on one
  HTTP server kill each other's handshakes (found live: the SDK's socket
  connect loop 400'd against the gateway's listener).

## 2026-07-19 — Channel rename/topic permission: any channel member

`PATCH /v1/channels/:id` (ui_nits item 5) needed a permission rule and none
existed to copy — the codebase had no rename endpoint. Ruled **any channel
member** may edit name/topic: it matches Slack's default and the codebase's
permissive pattern for non-destructive ops (any workspace member creates
channels, any member adds people to public channels), while destructive ops
(archive, remove-member) stay owner/admin/creator. Guards: standard channels
only, not archived, #general cannot be renamed (its topic can change),
name collisions 409.

## 2026-07-19 — Email-first registration (operator ruling)

Registration collects **only an email**; name + password are set on the emailed
link's "finish your account" page (Slack-style). Ruled over password-at-register
because it (a) kills register-time account enumeration — the response is always
"check your email", with an "you already have an account" note sent to existing
addresses; (b) prevents account pre-hijacking — an attacker who registers a
victim's email can no longer plant a password, since credentials are only ever
set by whoever clicked the link; (c) reuses the reset-password machinery. No
user row exists until completion (`pending_signups`, single-use sha256-hashed
tokens, 48 h). The dev-driver-only `autoVerify` one-shot register stays for QA
scripts and macOS dev.

## 2026-07-19 — Email verification + password reset (deploy prep)

- **Target stack ruled by operator**: Railway (app), Neon (Postgres), Cloudflare
  (blob storage + email). Built local-first: email goes through a driver seam
  (`src/email/`, same pattern as the blob-store seam) — dev driver writes JSON
  to `.emails/` and logs the link; the Cloudflare driver is a loud stub until
  the deploy step wires it.
- **Verification is default-on with a dev-only bypass**: `/v1/auth/register`
  has many consumers (macOS, QA seed, smoke/e2e scripts), so instead of a
  server-wide toggle, clients pass `autoVerify: true`, honored **only when the
  email driver is `dev`** — production semantics can't be weakened by a client.
  Existing accounts grandfathered verified in migration 0006; bots created
  verified.
- **Emailed tokens reuse the app-link pattern**: single-use, sha256-hashed at
  rest (`email_tokens`), atomically consumed via DELETE…RETURNING; re-request
  invalidates prior tokens of the same purpose. Verify = 48 h, reset = 60 min.
- **Verify link doubles as sign-in** (no separate "now log in" step), and
  **password reset revokes every session** then issues a fresh one; a used
  reset link also counts as email verification (it proves address ownership).
- **Links land on the web root as query params** (`/?verify=`, `/?reset=`) —
  the SPA has no router; App.tsx strips them via history.replaceState.

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

## 2026-07-18 — Phase 2 pre-flight: operator answers and approved deviations

Operator rulings from the phase-2 pre-flight review (recorded before implementation):

- **macOS .app bundle packaging is in phase 2**: a minimal build script wraps the SwiftPM executable in `MyChat.app` with an Info.plist. Required because `UNUserNotificationCenter` needs a real bundle (bare executables can't post banners); also activates the `myapp://` URL scheme deferred from phase 1. `swift build` and the QA bare-executable launch path keep working.
- **Emoji picker**: macOS uses the NATIVE character palette (no custom grid); the web client gets the custom grid + search. `:shortcode:` autocompletion in both composers.
- **Group mentions (@channel/@here/@everyone) are IN SCOPE for phase 2** (operator override of the PM recommendation to defer): parse at write time, fan out notifications to channel members respecting notify levels, picker/autocomplete entries in clients. Stored Slack-style in bodies (`<!channel>` etc.) alongside `<@userId>` user mentions.
- **Notify-level setter ships in phase 2**: `PUT /v1/channels/:id/notify {level}` (0=mute, 1=mentions, 2=all — matching the existing `channel_members.notify_level` smallint) plus mute/all controls in the channel context menu on both clients. Without a setter, §4's "mute suppresses everything" would be dead code.
- **Web QA = Chrome-driven smoke tier** once the web client lands; full web tier only on request.
- **Mid-phase checkpoint**: operator reviews after build item 6 (server + macOS feature-complete, QA green) before web client bring-up. Tree stays committed at sensible milestones.

Approved deviations from phase2.md as written:

- **Notification subject is `user.{userId}.notify`** (user-global), not `ws.{workspaceId}.user.{userId}.notify`: matches the existing `user.{userId}.meta` pattern, one subscription per socket instead of per socket×workspace; the event envelope already carries `workspaceId`/`channelId`.
- **Avatars bypass the `files` table**: stored via the storage interface with `users.avatar_url` pointing at them, unencrypted (per §6's cacheability requirement). Keeps the orphan sweep trivially "any unattached `files` row older than 24h" with no avatar special-casing.

## 2026-07-18 — Phase 2 implementation calls ratified at the item-6 checkpoint

- **Notification kind 3 = channel activity**: phase2.md §4's smallint enumerated only 0=mention, 1=dm, 2=thread_reply, but `notify_level=all` needs a row per channel message; kind 3 covers it rather than mislabeling as a mention. Precedence per (user, message): dm > mention > thread_reply > activity — one notification row max.
- **Message edits do not (re-)notify mentions**: parse-at-write model; re-notifying on every typo fix is noise. A mention added by an edit will not notify until/unless a later phase decides otherwise.
- **Item-6 checkpoint bug (fixed, `dd499fe`)**: the macOS reaction-picker popover dismissed on mouse move because its anchor button unmounted when the row lost hover — anchors of open popovers must stay mounted. QA smoke now regression-checks with real CGEvent pointer input (`apps/macos/tools/mouse.swift`), guarded to never inject input while the human is using the desktop.

## 2026-07-18 — Phase 3.5 rulings (pre-implementation)

Operator rulings on the phase-3.5 pre-flight (six client features before phase 3):

1. **Footer split**: avatar click = user menu (My Profile…, Sign Out, admin "Workspace color…" entry); name/status/chevron keeps opening the status picker unchanged. My Profile and Sign Out MOVE OUT of the top workspace menu, which becomes workspace-scoped only (switch/create/invite/accept).
2. **Composer markdown (operator override of PM recommendation)**: blockquote (`>`) and code-block (```) styling render live INSIDE the composer input itself — contenteditable on web, NSTextView/custom editor on macOS — not a separate preview pane. Message rendering in both clients also gains blockquote + code-block styles. Bodies stay literal markdown (no schema change; old messages gain styling retroactively). QA drivers must still be able to type into the swapped input elements; testids/AX ids preserved. If a genuine feasibility wall appears, ship the best achievable in-input styling and report the gap honestly at the checkpoint.
3. **Sidebar color = workspace-wide branding** (not per-user): `sidebar_color` on the workspaces row; setter permission-gated to owner/admin (same bar as invites); broadcast on the meta subject so all clients restyle live; curated preset palette (~8 gradients tuned for white-text legibility). Picker in the workspace menu ("Workspace color…"), hidden for non-admins.
4. **Profile viewing relocation** (member-click now opens the DM): right-click/⋯ on member rows → View profile; clicking an open DM's header shows the other member's card.
5. **Sidebar width = local per-device preference** (UserDefaults/localStorage), clamped ~180-360, double-click resets. Not synced.

Build order: item 4 (click→DM) → 1 (footer split) → 3 (image paste) → color → width → markdown last. Same working agreement as phase 2 (milestone commits, QA alongside, idle-gate/authorized UI automation, checkpoint stop for operator review when all six are feature-complete and QA-green on both clients).

## 2026-07-18 — Phase 4 rulings (pre-implementation; phase 3 deferred, phase 4 pulled forward)

Operator resequencing: phase 3 (Railway/OAuth/email/prod keys) is DEFERRED, not cancelled; phase 4 next. Pre-flight dependency audit found all of phase 4 buildable locally. Rulings:

1. **App-management UI is web-only** (admin surface; REST endpoints exist regardless; macOS UI can follow later if wanted).
2. **Key-rotation CLI DEFERRED TO PHASE 3** (operator override of the PM recommendation to adapt it to the sealed key file now): phase 4 is Slack app compatibility ONLY. No multi-key file adaptation, no rotation tooling; the phase-1 rotation IOU stays parked until phase 3's real key management (master key wrapping `data_keys` rows).
3. **Slack SDK test dependencies approved** (`@slack/web-api`, minimal Bolt harness) — test-only devDependencies, the "existing Slack bots work" proof.
4. **No rate limiting / 429s on the compat surface** until phase 3 (consistent with the phase-2 deferral); Slack SDKs tolerate their absence.
5. **Event set = core + channel lifecycle**: message.channels / message.groups / message.im, app_mention, reaction_added / reaction_removed, member_joined_channel, PLUS channel_created, channel_archive, member_left_channel. Echo suppression by `bot_user_id`.

Ratified implementation plans: SPA-fallback exemption extends to `/api/*`; mrkdwn converter covers bold/italic/strike/code/links/mentions with `<#channelId>` degrading to `#name` and Slack special tokens degrading to fallback text (documented lossy edges); bot users are real `users` rows (`is_bot`) appearing in users.list and reading offline in presence; bots become workspace members at app creation and join channels explicitly. Events delivery via the `pending_app_events` Postgres outbox (Ruling 3 of 2026-07-18) written in the same transaction as the triggering write.

## 2026-07-18 — Design adoption: "Quiet, in violet" (design 3a) + user status

Operator delivered a high-fidelity design package (~/Downloads "Slack clone design
concepts.zip", handoff README with exact tokens); implemented interactively by the
orchestrator across server/web/macOS (commits 304ebe1, b44aad3, 5502801).

- **User status feature added** (not in any phase doc; the design's core interaction):
  `users.status_emoji/status_text` (empty = cleared, single-RGI-emoji validated, set/clear
  together), extended `PATCH /v1/me`, carried on UserDTO + WorkspaceMemberDTO, broadcast
  via the existing `user.updated` meta event. Canned 8-option picker in both clients
  (custom popover on both — small deviation from the emoji-picker ruling since options
  are fixed label+emoji pairs, not free emoji).
- **Design tokens**: oklch converted to sRGB hex for SwiftUI (MC enum); Tailwind 4
  @theme tokens on web. Initials-on-color avatar palette per the handoff.
- **Web layout gained the 64px workspace rail**; notifications bell moved into the
  channel header (design has no top strip).
- **QA hooks**: testids/ax-ids preserved; new status ids (web: status-footer,
  status-picker, status-option-<n>, status-clear; macOS: sidebar.statusFooter,
  status.picker, status.option.<n>, status.clear). macOS sidebar is now custom rows
  (not List) — selection exposed via AX isSelected trait.
- **Dev note**: rebuilding packages/web/dist requires a server restart to re-register
  static asset routes (@fastify/static wildcard:false snapshots files at boot).

## 2026-07-19 — Phase 5 pre-flight: operator rulings

Pre-flight Q&A before implementing phase5.md (attachment/image UX, thread panel
upgrades). Operator rulings:

1. **Animated GIFs autoplay inline** (not click/hover-to-play). Clients render the
   original file for `image/gif` instead of the static webp thumb — web `<img>` on
   the original blob; macOS via a new `AnimatedAuthImage` (NSImageView `animates`,
   SwiftUI `Image` renders only the first frame). No server change; thumbnails stay
   static webp for non-GIF paths and composer previews.
2. **Image collapse state is persisted per device** (Slack-like), not session-only:
   web `localStorage['mychat.collapsedImages']`, macOS `UserDefaults` — both capped
   at 500 ids, oldest dropped.
3. **Built directly by the coordinator in-session** (operator chose this over the
   usual PM delegation for phase-scale work).

Implementation rulings (coordinator):
- **Reply participants (item 7) are computed on read, not denormalized**: new
  `MessageDTO.replyParticipantUserIds` (first 4 distinct reply authors in
  first-reply order) hydrated per page via one `DISTINCT ON (thread_root_id,
  user_id)` query — Postgres has no `min(uuid)` aggregate, so DISTINCT ON picks
  each author's first reply and JS orders/caps. macOS mirrors the rollup locally
  when replies arrive (same first-4 semantics); web refetches via react-query
  invalidation, so it needs no client-side merge.
- **Thread panel width follows the sidebar-width ruling**: local per-device
  preference (web localStorage, macOS @AppStorage), clamped 280–560 (macOS,
  default 340) / 280–560 (web, default 384), double-click/tap resets.
- **macOS "Download" saves to ~/Downloads** (uniqued on collision) and reveals in
  Finder — the platform equivalent of the browser download the web client gets
  for free.

## 2026-07-19 — Web-to-app auth handoff (operator feature)

Operator direction: sign-up/login happen on the web; after web sign-in a CTA
opens the native app, which signs in via URL. Coordinator rulings:

- **One-time code exchange, not token-in-URL**: the web session mints a
  single-use 2-minute code (`app_link_codes`, sha256-hashed like sessions,
  migration 0005); the app exchanges it for its own session. Deep-link URLs
  land in logs/LaunchServices — the raw session token never rides in one.
  Exchange consumes the code atomically (DELETE … RETURNING); expired rows
  are swept opportunistically on mint.
- **CTA placement**: prominent button on the workspace chooser + slim
  dismissible banner (localStorage) across the top of the signed-in app.
- **macOS replaces any existing session** on a signin link (logout first —
  the code may be for a different account and the local cache must not mix
  users).
- **Multi-instance caveat (QA setups)**: LaunchServices delivers myapp://
  URLs to one running instance of the bundle — with several MYCHAT_PROFILE
  instances running, the code signs in whichever instance receives it.
  Normal single-instance usage is unaffected; during QA, fire links only
  with the intended instance running. Also: delivery can fail silently in
  the first seconds after launching the raw binary (before LS registration
  settles) — verified working once the instance is registered.

## 2026-07-19 — Rename: MyChat → Flow (deep rename, operator ruling)

Operator chose the DEEP rename (over branding-only) plus the flow:// scheme:

- **Renamed**: product strings/titles (web + macOS), Flow.app bundle
  (CFBundleName/Identifier com.flow.macos, executable Flow), SwiftPM package/
  target/dirs (Sources/Flow, FlowTests), @flow/* package scope, root package,
  FLOW_* env vars (FLOW_PROFILE, FLOW_DATA_KEY*, FLOW_FILE_DIR), web
  localStorage keys flow.*, Keychain service ai.biztrip.flow, macOS app-support
  dir Flow<suffix>, docker project/containers (flow, flow-postgres, flow-nats),
  Postgres role/db/password flow/flow/flow_dev, NATS client name, deep-link
  scheme myapp:// → flow:// (invite + signin), bot email domain
  apps.flow.local (new bots only; existing bot rows keep their emails).
- **Data preserved** via pg_dump → new flow stack → restore (139 users /
  351 messages / migrations intact verified). Old mychat containers removed;
  old volume left behind (mychat_pgdata — deletable).
  rename the live working dir; cosmetic); the codesigning cert is still
  named "MyChat Dev Signing" (renaming means minting + trusting a new cert —
  the identity name is dev-keychain-only); historical docs (CHANGELOG,
  decision_log, phase*.md) keep old-name mentions.
- **Consequences accepted with deep rename**: all clients signed out (new
  Keychain service + localStorage key) — both QA app instances re-signed-in
  via the new flow://signin handoff (dogfooded, works); local GRDB caches
  reset (resync); web prefs (sidebar/thread widths, collapse state) reset.

### Addendum (same day): repo directory renamed too

Operator follow-up: /Users/scottp/mychat → /Users/scottp/flow. Dev server and
app instances stopped, directory moved, server restarted from the new path,
Flow.app instances relaunched and re-registered with LaunchServices (flow://
now binds to the new bundle path). Claude project memory migrated to the new
project directory. Remaining old-name artifacts: the "MyChat Dev Signing"
cert and old-name mentions in historical docs only.

## 2026-07-20 — Phase 7 (iOS parity) — PM rulings, pending operator review

Operator started the phase without answering the phase7.md pre-flight
questions; the doc's recommendations were applied as PM rulings:

1. **Push notifications (tier 3 item 8): deferred** to a follow-on phase — no
   server-side APNs work this phase. The Parity section keeps it as the iOS gap.
2. **Files scope**: photo library + Files document picker; camera is a stretch
   goal only if time allows.
3. **Composer**: plain text + @-mention autocomplete only; the live-styled
   fence/code composer (NSTextView port) is NOT ported. Rendering is full
   parity; only input styling differs (recorded as deliberate divergence).
4. **Edit UX**: sheet editor, like macOS.

Implementation judgment calls (also pending review):
- **iOS reaction picker** = custom grid + search sheet (web parity), since the
  macOS native character palette has no iOS equivalent for this use.
- **Autocomplete UI** = horizontal chip bar above the composer (touch idiom)
  rather than the macOS vertical list; same trailing-token matching logic.
- **Headless QA limits**: simctl cannot tap, so long-press menu, autocomplete
  insertion, and outgoing typing emission were verified by code parity +
  build, with engine-path DEBUG hooks (FLOW_DEBUG_REACT/EDIT_LAST/DELETE_LAST/
  REPLY_LAST/OPEN_THREAD_LAST) exercising the same mutations end-to-end
  against the local QA server. Operator spot-check of the touch interactions
  recommended.
- **Environment note**: the iOS 26 simulator runtime on this machine renders
  emoji as tofu (missing Apple Color Emoji in screenshots) — chips, counts,
  and highlights verified; glyph rendering itself needs a device/runtime
  spot-check. Not an app bug.

### Phase 7 tier 2–3 addenda (same day) — PM rulings, pending operator review

- **Camera stretch goal reached**: added as a third attach-menu item
  (UIImagePickerController → JPEG → shared upload pipeline), hidden on
  hardware without a camera. Simulator cannot exercise capture — device
  spot-check needed.
- **iOS local banner notifications stay no-ops** until the push phase: the
  socket is suspended in the background (no events to bannerize), and
  foreground banners would double-notify the visible app. The app-icon badge
  IS live (unread notification count, macOS dock-badge parity).
- **Badge permission prompt skipped in DEBUG runs with FLOW_DEBUG_* set** so
  the un-tappable system alert can never wedge headless simulator QA.
- **HEIC photo picks are re-encoded to JPEG** before upload so the server's
  thumbnail pipeline (webp thumbs) works; PNG/JPEG/GIF/WebP upload as
  original bytes.
- **Mark-read on scroll** judged already-covered: the shared engine marks
  read on channel open and while the channel is active (same semantics as
  macOS) — no extra scroll-position tracking added.

## 2026-07-20 — UI-nits batch (PM rulings, pending operator review)

- **App tokens stored raw alongside their hashes** (migration 0011) so
  owners/admins can view them later in Manage Apps (ui_nits). Considered
  encrypt-at-rest instead; rejected as security theater here: the app-level
  key would live in the same environment as the DB credentials, and the DB
  already stores each app's signing secret in plaintext, so plaintext raw
  tokens don't change the threat model. Auth lookups still go through the
  hash columns only. Apps created before 0011 have NULL raw tokens
  (irrecoverable from the hash) — the UI labels them "created before token
  visibility" and offers **Regenerate tokens** (POST
  /v1/apps/:id/credentials/rotate; new bot+app tokens, old ones stop
  authenticating, signing secret untouched). PM ruling, pending operator
  review.
- **Video previews ship without server-side poster/thumbnail generation**:
  the web card shows the first frame once the (fully fetched, ≤20 MB) blob
  loads; the macOS card uses a film-icon play placeholder and only downloads
  the video when the user hits play. Extracting poster frames server-side
  would add an ffmpeg-class dependency for marginal benefit — revisit if
  videos get heavy use.
- **webm plays inline on web only**: AVFoundation has no VP8/VP9/webm
  support, so macOS renders webm attachments as a file chip (Download/open
  externally). Deliberate divergence recorded in CHANGELOG Parity.

## 2026-07-20 — AI Agents phase pre-flight (operator rulings)

- **Agent badge is a small robot emoji (🤖)** next to the display name, not a
  text badge; Slack-compat app bots' rendering is untouched.
- **Bridge event scope defaults to mentions + DMs**; full-channel traffic is
  per-agent config opt-in.
- **Agent tokens are non-expiring until revoked** (daemon-friendly; sibling
  of sessions, hash-stored, lastUsedAt tracked).
- **"Invite an Agent" is web-only admin surface**, same pattern as Apps.
- **Tool calls surface as a live "thinking…" step**: the bridge parses
  stream-json, posts one status message on first tool use, edits it in place
  per tool call, deletes it and posts the final reply fresh on completion.
  (Operator upgraded from the recommended typing-indicator-only default.)
- **MCP rich mode ships in v1** (`flow` MCP server: send_message, react,
  upload_file, search_history) alongside the baseline final-text contract.

## 2026-07-21 — Phase 9 (Artifact tabs) pre-flight (operator rulings)

- **Artifacts are personal, per-user bookmarks** — each artifact row is owned
  by one user and visible only in that user's sidebar (not channel- or
  workspace-shared). Sidesteps cross-channel visibility leaks entirely.
- **Removing an artifact never deletes the underlying file**; the file stays
  in its channel/message untouched.
- **macOS parity ships in this phase** (not logged as a gap): Artifacts
  sidebar section + artifact panel land on both clients together.
- **MCP `create_artifact` fans out to humans** (implementation consequence of
  per-user ownership): when an agent creates an artifact in a channel, the
  bridge/server creates one personal artifact row per human member of that
  channel (agents excluded), each independently removable. In a DM with the
  agent that's just the human peer.

## 2026-07-21 — Phase 9 correction: artifacts target one person, not a channel

- **`create_artifact` creates an artifact for a single recipient** (operator
  correction, superseding the 2026-07-21 fan-out ruling). The earlier design
  created one personal row per human member of the channel; that was too
  broad — an agent working for one person should not fill five sidebars.
- **Recipient defaults to the user who triggered the agent** (`FLOW_USER_ID`,
  the author of the message the bridge is responding to — the DM peer, or the
  person who @-mentioned it in a channel). Overridable with an explicit
  `userId`.
- **Authorization is now "caller and target share a channel"** rather than
  "caller names a channel". Same anti-spam property (an agent can only reach
  people it already shares a channel with), and it drops the requirement for
  conversation context — fixing the gap where an agent with no
  `FLOW_CHANNEL_ID` could not create an artifact at all.

## 2026-07-22 — Phase 12 (#Activity feed) design ruling

- **#Activity is a virtual, per-user channel, not a real one.** It has no DB
  row, no membership, and required no server change or migration — it renders
  the existing per-user `/v1/me/notifications` feed (the same data the removed
  bell used) as an in-place channel view. A real shared channel was rejected:
  the alerted-message set is inherently personal (each user's mentions/DMs/
  thread-replies), which a workspace-shared channel can't represent, and
  copying messages into it would duplicate content and leak cross-channel
  visibility.
- **The bell is fully removed on the clients that had it** (web + macOS); the
  unread badge moves onto the Activity sidebar row. Opening Activity marks read
  up to the newest row (channel semantics), reusing the existing single
  `upToId` read cursor — not per-message read state.
- **Ships on all three clients in-phase** (not logged as a parity gap): iOS,
  which never had a bell, gets the feature net-new — the shared model/engine/
  socket layer already carried notifications, so only iOS UI was added.

## 2026-07-22 — Phase 12 follow-up: Activity jump-to-message

- **Tapping an Activity row jumps to the exact message, not just the channel**
  (operator request during phase 12 review). The old bell — and the initial
  Activity implementation — only opened the channel, which read as a no-op when
  the target was the channel you were already in. Now the client scrolls to and
  briefly flashes the triggering message.
- **Targets beyond the loaded page are reached by paging** older history until
  the message is in the list, then giving up (releasing the target) once the
  channel's history is exhausted (e.g. a hard-purged message). A soft-deleted
  message still renders its tombstone, so it's found and flashed.
- **iOS ships top-level jumps only, by decision** — thread replies live in a
  separate pushed screen there, so a thread-reply row lands in the channel
  without opening the thread. Logged as a Parity gap rather than blocking the
  phase.

## 2026-07-23 — Phase 13 (side-panel, per-channel artifacts) rulings

Supersedes both phase-9 artifact rulings above (the per-user model and the
one-recipient MCP correction).

- **Artifacts are per-channel shared objects**, not personal per-user
  bookmarks. Every member of a channel sees the same artifacts; privacy is
  achieved by pinning in a private channel. The gateway's existing `visible()`
  filter (envelope `channelId` + private-channel membership) enforces this on
  the event stream, so no new access plumbing was needed.
- **Backing files are mutable.** An artifact points at a file that can be
  swapped for a freshly uploaded one — this is how an agent "updates" an
  artifact. Files themselves stay immutable blobs; the artifact row carries the
  current `file_id` plus an `owns_file` flag.
- **The side panel is a tabbed container** (operator decision, revised during
  the build from an initial "mutually exclusive slot"). The right-hand pane —
  which occupies the same space as the thread panel — shows a tab strip: a
  Thread tab when a thread is open, plus one tab per artifact pinned in the
  active channel. Threads and artifacts coexist; the active tab picks what
  shows. Opening a channel-nested artifact selects its channel behind the panel.
  The panel ✕ closes everything; the Thread tab has its own ✕. In the sidebar
  the selected artifact is bold text with no highlight pill, so it doesn't stack
  a second white pill under the active channel's.
- **Migration drops existing per-user artifact rows** (operator decision) —
  they have no channel to map to and are low-value pins of already-shared
  files. The table is recreated channel-scoped in `0019_artifacts_channel.sql`.
- **Deleting an artifact deletes its own backing file** when the artifact owns
  it (agent-generated / uploaded-for-artifact), guarded so a file still
  attached to a message or pinned by another artifact is kept. This reverses
  the phase-9 "removing an artifact never deletes the file" ruling — but only
  for owned files; pins of message attachments still leave the file untouched.
- **MCP `create_artifact` targets the current channel** (`FLOW_CHANNEL_ID`),
  dropping the single-recipient model; **`update_artifact`** is new (rename
  and/or replace content in place). An artifact is shared, so any channel
  member — not just its creator — can rename, update, or delete it.
- **macOS parity ships in-phase** (not a gap); iOS artifacts UI remains a
  Parity gap, now tracking the per-channel model.
