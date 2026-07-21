# Changelog

Convention: every feature/fix entry tags the platforms it landed on —
`[server]` `[web]` `[macos]` `[ios]` `[qa]`. A change that lands on one client
but not the others MUST add a line to **Parity** below (and remove it when
closed). Updated with every milestone commit (PM) and interactive-session fix
(coordinator).

## Parity

### Gaps to close
- iOS: no Artifacts UI (phase 9) — no sidebar section, artifact panel, or
  save-as-artifact action; the `artifact.*` WS events are safely ignored.
  Server + web + macOS shipped together 2026-07-21.
- macOS/iOS: no agent pairing prompt — sponsors must approve agent
  registrations in the web app (the `agent.pairing` WS event is safely ignored
  by the native clients; roster `sponsorId` likewise unused there yet).
- macOS/iOS: video playback downloads the whole file before playing (streamed
  to disk, not RAM); web streams in place via the presigned URL. Matters at
  the new 500 MB scale — native fix is AVPlayer on the `/v1/files/:id/url`
  presigned URL.
- iOS: no mention-of-non-member CTA after @mentioning someone outside the
  channel (web + macOS offer "Add to channel" — matters most for agents, which
  never see mentions in channels they haven't joined). iOS has its own composer
  (not the shared macOS one), so the CTA needs porting there.
- macOS: sidebar doesn't list DM-less agents under Direct Messages (web shows
  virtual rows with presence + 🤖 that create the DM on click).
- Web composer: browser-native undo degrades after programmatic splices
  (autocomplete/suggestion inserts) — contenteditable limitation; macOS undo is clean.
- macOS: pasting a non-image file URL inserts its path as text; web handles
  arbitrary files via drop/picker. (Drag-drop attach works on both.)
- Web: one session token per browser origin — two accounts in two tabs collide
  (macOS profiles handle multi-account). Candidate phase-3-adjacent fix.
- macOS: workspace-chooser tiles ignore AX activation (real click required) — a11y gap.
- No syntax highlighting in code blocks (both clients; never scoped).
- iOS: no push notifications (APNs — deferred to a follow-on phase; needs
  server device-token registry + Apple push key + device testing). Everything
  else in core messaging + files is now at parity.
- macOS has no in-app registration, password-reset, or passwordless sign-in
  link against real servers — by design it links to the web (email-first flow +
  app-link handoff); the dev-only autoVerify register remains for the local dev
  server. (iOS same — auth is web-driven.)
- iOS: no inline video preview/playback card — video attachments render as a
  name+size chip that opens in QuickLook (which does play them); web/macOS
  render inline players with an expand affordance.

### Deliberate divergences (ruled)
- Emoji picker: custom grid + search on web and iOS (reaction sheet); native
  character palette on macOS.
- iOS composer: plain text + @-mention autocomplete only — no live-styled
  fence/code composer (PM ruling per phase7.md recommendation, pending
  operator review). Markdown still renders fully; sugar expands at send time.
- iOS message actions: long-press context menu (no hover on touch).
- App management UI (Slack-compat apps): web only.
- Agent-skill download link on the logged-out home: web only — the native
  clients link out to the web for the whole signed-out/auth surface (see the
  in-app-registration divergence in Gaps), so the skill CTA lives there too.
- Agent management UI (agents roster, remove agent, pairing approval): web
  only (operator ruling 4, like Apps). All clients render the 🤖 badge.
- User admin panel (Manage Users — role changes + remove from workspace):
  web only, consistent with Apps/Agents management UIs. macOS shows neither the
  menu item nor the sidebar row. The server endpoints are platform-neutral, so
  a macOS UI can be added later. See History 2026-07-21.
- Local per-device (not synced) prefs: sidebar width, thread-panel width,
  image collapsed/expanded state (ruled).
- webm videos play inline on web only: AVFoundation has no VP8/VP9/webm
  support, so macOS shows the file chip (Download / open externally) for
  webm attachments (ruled — see decision_log 2026-07-20).

## History

### 2026-07-21 — Logged-out home links to the agent skill download
- The signed-out auth screen now shows a prominent "Bring your AI agent to
  Flow" card below the sign-in box that downloads the `flow-agent-member`
  skill (`SKILL.md`) — the how-to that teaches a coding agent to self-register,
  run the agent-bridge, and use the `flow` MCP tools. `[web]`
- The skill ships as a static asset at `/flow-agent-member-SKILL.md`, served
  from `web/dist` by the same process. `skills/flow-agent-member/SKILL.md` is
  the single source of truth; a `predev`/`prebuild` step copies it into
  `web/public` (the copy is git-ignored) so the download never drifts. `[web]`
- New skill authored: `skills/flow-agent-member/SKILL.md`. `[qa]`

### 2026-07-21 — Artifacts: create_artifact targets one person, not a channel
- Operator correction to the phase 9 fan-out: an agent works for a person, not
  a room, so `create_artifact` now creates **one** artifact for **one**
  recipient instead of a personal copy for every human member of the channel.
- The recipient defaults to whoever the agent is responding to — the bridge
  now passes `FLOW_USER_ID` (the triggering message's author) into the MCP
  env, so the tool needs no argument in normal use; an explicit `userId`
  overrides it.
- Authorization changed from "caller names a channel" to "caller shares a
  channel with the recipient". Same anti-spam property — an agent can only
  reach people it already shares a channel with — but it drops the need for
  conversation context, closing a gap where an agent running without
  `FLOW_CHANNEL_ID` could not create an artifact at all.
- `POST /v1/channels/:id/artifacts` (fan-out, returned a list) is replaced by
  `POST /v1/artifacts/share` (`{fileId, userId, name?}`, returns one
  ArtifactDTO). Server-only change; no client work. `[server]`

### 2026-07-21 — Fix: agent-created artifacts were unreadable by their recipients
- Reported live: an agent created an artifact from a markdown file and the
  panel showed an empty pane with a "click to download" card, while the same
  file previewed fine when shared in chat. The cause was file access, not
  markdown. `requireFileAccess` grants a non-uploader only when the file is
  attached to a message in a channel they can read — but the MCP
  `create_artifact` deliberately uploads without posting, so `GET /v1/files/:id`
  404'd for every recipient, the web `TextPane` fetch failed, and it fell back
  to the download card (whose download 404'd too). Any agent-created artifact
  of any type was affected. Holding an artifact bookmark of a file is now
  itself a read grant — safe because the row only exists if the user
  bookmarked a file they could already read, or a channel member with access
  shared it via `shareArtifact`. Regression coverage both ways: a recipient
  can read an artifact-only file, and a workspace member without a bookmark
  still 404s. No client change — fixes web and macOS alike. `[server]`

### 2026-07-21 — Phase 9: Artifact tabs
- Artifacts: personal per-user bookmarks of files shared in chat (operator
  rulings, decision log 2026-07-21). New `artifacts` table (migration 0016) +
  `ArtifactDTO`; REST create/list/rename/delete under `/v1/artifacts` and
  `/v1/workspaces/:id/artifacts`; `artifact.created/updated/deleted` events on
  the per-user notify subject. Removing an artifact never deletes the file;
  the orphan-file sweep now exempts artifact-referenced files (agent-created
  artifacts may never be attached to a message). `[server]`
- Web: "Artifacts" sidebar section (glyph by file type, hover ✕ removes);
  message hover menu gains an open-external "Save as artifact" action on
  messages with files (operator-picked icon — the app's only inline SVG, since
  no unicode codepoint draws the box-with-arrow mark), and the new artifact
  panel opens automatically. Full-pane artifact viewer for
  images, video (presigned streaming), text, PDF, and HTML — HTML renders in
  a sandboxed `srcDoc` iframe (`sandbox="allow-scripts"`, no same-origin, so
  artifact HTML can never reach the session token or call the API). Rename by
  clicking the panel title. File-type detection extracted to
  `lib/fileKind.ts` (shared by chat attachments + artifacts). `[web]`
- macOS: parity — Artifacts sidebar section, artifact panel (image / video /
  text / PDF / HTML via sandboxed WKWebView), 🔖 save-as-artifact on messages
  with attachments, live `artifact.*` sync. `[macos]`
- MCP: new `create_artifact` tool (flow MCP) — inline content, a local file
  path, or an existing fileId; uploads then fans out one personal artifact per
  human channel member via `POST /v1/channels/:id/artifacts` (agents/bots
  excluded as recipients). `[server]`
- New DB-backed vitest suite `test/artifacts.test.ts` (13 tests: idempotency,
  access control, fan-out, sweep exemption). `[qa]`

### 2026-07-21 — Bridge 0.3.4: `mcp-init` — use the flow MCP server directly, no daemon
- New `flow-agent-bridge mcp-init [agent.json]` command: writes a `.mcp.json`
  in the current directory so MCP clients (the Claude CLI reads `./.mcp.json`
  on startup; Claude Desktop can copy the entry) load the bundled `flow` MCP
  server and act as the agent — pull-only, no daemon/presence/push. The
  command validates the token and resolves the workspace id against the
  server (agent.json doesn't store it; `list_channels`/`list_users`/
  `upload_file` need `FLOW_WORKSPACE_ID`), merges the `flow` entry into an
  existing `.mcp.json` without clobbering other servers, writes it chmod 600,
  and appends it to `.gitignore` (it holds the agent token). Prefers the
  global `flow-agent-bridge` bin when on PATH, else pins node + the local
  build. AGENT_MEMBERS.md gains a "Using the flow MCP server directly"
  section, including the caveat that one live token per agent means `login`
  for direct use knocks out a running daemon. `[server]`

### 2026-07-21 — macOS: "Add to channel" CTA when you @-mention a non-member
- Closes a parity gap surfaced live: @-mentioning an agent (or person) not in a
  standard channel silently did nothing on macOS — the agent-bridge drops
  mentions in channels it hasn't joined (`bridge.ts` inScope), so nothing
  responded and there was no hint why. The @-typeahead deliberately still lists
  all workspace members (operator ruling: keep it broad, prompt to invite when
  the target isn't present). After a successful send, `SyncEngine.sendMessage`
  now returns the mentioned userIds that aren't channel members (standard
  channels only; fetched via `GET /v1/channels/:id/members`), and the composer
  shows an "…isn't in this channel and won't see your mention" banner with an
  **Add to channel** button (`POST /v1/channels/:id/members`). Mirrors the web
  `doSend` flow (`Composer.tsx`); re-mention after adding to actually reach
  them. `[macos]`

### 2026-07-21 — Fix: agent's ephemeral "thinking…" status no longer leaves a tombstone
- The agent-bridge posts a live `🤖 *thinking…*` status message while working,
  then deletes it on completion and posts the real reply as a fresh message
  (clean unread semantics). But delete was a *soft* delete — the row stayed with
  `deletedAt` set and both clients render that as a "This message was deleted"
  tombstone, which sat directly above the real reply (earlier id → sorts first).
  Added a **hard delete / purge** path: `DELETE /v1/messages/:id?purge=true`
  removes the row outright (child reactions/files/notifications cascade; a purged
  thread reply decrements the root's rollup and recomputes `lastReplyAt`) and
  publishes a new `message.purged` WS event so clients splice the message out
  with no tombstone. The bridge now uses it for its status message; ordinary
  user deletes stay soft (tombstone preserved). Web (`removeMessageFromCache` +
  `message.purged` handler) and macOS (`purgeMessage` in SyncEngine) both drop
  the row on purge; iOS inherits the same via the shared macOS core
  (Models/SyncEngine), so no iOS-specific change. New server vitest coverage
  (`test/purge.test.ts`: soft-vs-hard, idempotency, rollup recompute,
  author-only). `[server]` `[web]` `[macos]` `[ios]`

### 2026-07-21 — UI nits: macOS message hover menu no longer stutters
- Fixed the per-message hover toolbar (react / reply / edit / delete pill)
  blinking in and out while the cursor moved toward it. The pill is an overlay
  pinned to the row's top-trailing edge, outside the row's hover region, and
  `hovering` was flipped off synchronously — so travelling from the message
  text up onto the pill briefly unmounted it, which re-hovered the row and
  flickered it back. Now the hide is debounced (~120 ms) and cancelled when the
  cursor lands on the pill (the pill carries its own `.onHover`), so the menu
  holds still long enough to click. macOS-only; web's hover menu was unaffected.
  `[macos]`

### 2026-07-21 — UI nits: common missing Slack emoji aliases
- Added ~60 frequently typed Slack shortcodes that were missing from the
  shared catalog — the retired ui_nits `:thread:` (🧵) example plus a batch of
  common faces (`:smiley:` `:laughing:`/`:satisfied:` `:disappointed:`
  `:partying_face:` `:pleading_face:` …), hand gestures (`:point_down:`
  `:raised_hand:` `:fist:`/`:fist_raised:` `:call_me_hand:` …), and symbols
  (`:heavy_check_mark:` `:heavy_plus_sign:` `:bangbang:` `:sos:` `:ok:`
  `:arrow_forward:` `:repeat:` …). Landed in both the shared TS catalog
  (`packages/shared/src/emoji.ts`, drives web composer autocomplete + expansion)
  and the aligned Swift copy (`EmojiCatalog.swift`). New vitest coverage for the
  aliases and for `expandShortcodes` (case-insensitivity, bare-colon safety);
  Swift `EmojiCatalogTests` still green. `[web]` `[macos]` `[shared]`

### 2026-07-21 — Bridge 0.3.3: runtime.model config option
- New `runtime.model` in agent.json — `--model` passthrough to the claude CLI
  (`sonnet`, `opus`, `haiku`, or a full model id). Unset keeps the CLI's
  default. `[server]`

### 2026-07-21 — Fix: admin-panel removal of an agent now revokes its credentials
- Removing an agent via Manage Users (`removeMember`) removed its memberships
  but left its token and username/key alive — an authenticated zombie that
  could still call `/v1/me` and `login` (no data access, memberships gate
  everything, but wrong). `removeMember` now runs the same
  `killAgentCredentials` as the Agents-modal path when the target is an
  agent, so both remove buttons mean revocation. `[server]`

### 2026-07-21 — Agent avatars: preset picker at approval + set_avatar MCP tool (bridge 0.3.2)
- Approving an agent pairing request can now include a preset avatar: 12 robot
  faces bundled with the server (Flaticon free license, Freepik — see
  `assets/agent-avatars/ATTRIBUTION.md`), listed via `GET /v1/agent-avatars`
  and applied through the normal avatar pipeline (square-crop → webp → R2) so
  agents get ordinary `/v1/avatars/<key>` URLs. `ApproveAgentRequestBody`
  gains optional `avatar` (preset id, validated before anything is created).
  Precedence: sponsor's pick > agent-supplied `avatarUrl` > initials chip.
  `[server]`
- Web pairing prompt shows the preset grid (optional, toggle to deselect).
  `[web]`
- Bridge 0.3.2: new `set_avatar` MCP tool — the agent updates its own profile
  picture from a local image via `POST /v1/me/avatar` (10 tools now). `[server]`

### 2026-07-21 — Bridge 0.3.1: survive laptop sleep (WS liveness watchdog)
- The bridge only reconnected on the socket's `close` event, but a laptop
  sleep kills the connection while the machine is suspended — the FIN never
  arrives, `close` never fires, and the daemon sat "online" on a half-dead
  socket, silently ignoring all chat. New per-connection watchdog: the server
  heartbeats every 30s, so 90s with no inbound traffic terminates the socket,
  which drives the existing reconnect/backoff path. Found live: a daemon that
  slept through a lid-close stopped responding after wake. `[server]`

### 2026-07-21 — On-demand agent registration with human sponsors (bridge 0.3.0)
- Agent registration is rebuilt around sponsorship (AGENT_MEMBERS.md): the
  agent registers like a person — durable **username + secret key** plus a
  **sponsor email** — via unauthenticated `POST /v1/agents/register` (202 →
  pairing request; rate-limited per IP). The sponsor gets a live `agent.pairing`
  prompt showing a short pairing code; approving the matching code
  (`POST /v1/agent-requests/:id/approve`, workspace chosen there) creates the
  agent (`is_agent`, role `member`, `sponsor_user_id` recorded) and the agent's
  poll (`GET /v1/agents/register/:id`, pollSecret bearer) delivers the token
  exactly once. `POST /v1/agents/login` (username+key) re-mints a token and
  revokes the old — the lost-agent.json path, no admin involved. Any member can
  sponsor (ruled — permission knob later). Removing a sponsor from a workspace
  removes the agents they sponsor there; agent removal (admins **or the
  sponsor**) also kills the username/key credentials. The invite-key flow is
  retired: `agent_invites` dropped, invite/regenerate endpoints removed
  (migration `0015_agent_pairing.sql`; existing agents and their tokens keep
  working — they simply have no sponsor/credentials). `WorkspaceMemberDTO`
  gains `sponsorId`. `[server]`
- Web: floating **agent pairing prompt** (code, sponsor-responsibility note,
  workspace picker, Approve/Deny) driven by the `agent.pairing` WS event +
  `GET /v1/me/agent-requests`; Agents modal is now a roster with "sponsored
  by" and remove (visible to admins and the agent's own sponsor), menu item
  "Agents…" available to every member (invite-key minting/regenerate UI
  removed). `[web]`
- Bridge 0.3.0: `register` now takes `--sponsor/--username/--name` (key
  auto-generated if omitted), prints the pairing code and blocks until
  approval; new `login` command; interactive setup walks the same flow and
  saves username+key alongside the token for self-recovery. `[server]`
- AGENT_MEMBERS.md rewritten for the new flow (this change implements the
  updated spec).

### 2026-07-21 — Tombstone a user when removed from their last workspace
- Removing a human member from their **only** workspace now tombstones the
  account in the same transaction as the removal: `users.deleted_at` is set, the
  unique `email` is rewritten (`tombstone+<id>+<email>`) so the original address
  is free to register again, the password is scrubbed to an unusable sentinel,
  and all sessions / email tokens / app-link codes are dropped. The row is kept
  so the person's past messages keep their author name. Bots/agents are never
  tombstoned this way — they keep their `deleteApp` / `removeAgent` lifecycles.
  Migration `0014_user_tombstone.sql` adds the nullable column; because the
  tombstone's email no longer matches, `register`/`login`/`invite` lookups need
  no changes. `[server]`

### 2026-07-21 — Agent bridge 0.2.5: channel-operation MCP tools
- The `flow` MCP server grows from 4 to 9 tools: `list_channels`,
  `list_users`, `join_channel`, `leave_channel`, and `read_messages` (newest
  first, paged in reverse chron via a `before` cursor) join the messaging
  tools. All run against `/v1` with the agent's token, so server-side
  permissions apply. System prompt + AGENT_MEMBERS.md updated. `[server]`

### 2026-07-21 — Admin panel to manage users
- New owner/admin panel to manage workspace members. Two server endpoints:
  `PATCH /v1/workspaces/:id/members/:userId/role` (assign `admin`/`member` —
  `owner` is immutable and unassignable) and
  `DELETE /v1/workspaces/:id/members/:userId` (remove from workspace + every
  channel, reusing `removeMemberDeep`). Both are owner/admin-only and refuse to
  touch the owner or the acting user (no self-lockout). A new `member.updated`
  event broadcasts role changes on the workspace meta subject so every client
  refreshes the roster, and the affected member's own client re-derives its
  menu gating. `[server]`
- Web: the workspace menu gains an admin-only **Manage Users…** item that pins
  a virtual **Manage users** row into the channel list and opens it. The row is
  a client-only sentinel selection (`ADMIN_VIEW_ID`) — no real channel or
  membership — so its hover-✕ "close" is a pure per-device UI hide (persisted
  in `localStorage`, reopen from the menu), sidestepping the fact that Flow has
  no "close-but-stay-joined" for real channels (only Leave/Archive). The panel
  lists members with avatar/role, a role dropdown, and a two-click Remove
  confirm; owner and self rows are locked. `[web]`

### 2026-07-21 — 500 MB file cap + streaming video playback
- Direct (presigned) uploads now allow 500 MB per file (`FLOW_MAX_FILE_MB` to
  tune) — the bytes stream to R2, so the server never buffers them. The
  server-buffered paths (legacy multipart, Slack-compat `files.upload`,
  avatars) keep the old 20 MB cap. Images above 32 MB skip thumbnail
  generation (the sidecar step would pull the object into server memory). `[server]`
- New `GET /v1/files/:id/url`: JSON `{url, expiresInSeconds}` with a 1-hour
  presigned URL for in-place media playback (null on the local driver /
  legacy rows — callers fall back to the proxy fetch). `[server]`
- Web video cards stream instead of full-fetching: `<video src>` points at
  the presigned URL (R2 serves Range, so playback starts immediately and
  seeking never downloads the file); expired-URL errors re-mint once. Falls
  back to the old whole-blob path in local dev. `[web]`
- macOS/iOS upload/download now stream from/to disk (`URLSession`
  upload(fromFile:)/download(for:)) instead of holding whole files in
  memory — a 200 MB video no longer costs 200 MB of RAM. Playback still
  downloads before playing (see Parity). `[macos] [ios]`

### 2026-07-21 — R2 bucket CORS (prod fix)
- Web uploads/downloads against R2 failed on first prod smoke: browsers
  preflight the presigned PUT and CORS-check the 302'd GET, and the new bucket
  had no CORS policy (curl/URLSession testing never preflights, so it passed).
  Fixed with a bucket CORS policy (app.flowtoo.org + local-dev origins; GET/
  PUT/HEAD; content-type+range). Recipe recorded in DEPLOYMENT.md. `[server]`

### 2026-07-20 — Cloudflare R2 storage + presigned direct uploads
- File blobs move from local disk / Railway volume to Cloudflare R2 behind the
  existing `BlobStore` seam (`FLOW_BLOB_DRIVER=r2`); the app service becomes
  stateless. Local dev keeps the disk driver, no credentials needed. `[server]`
- New upload flow on all clients: `POST …/files/presign` reserves a `pending`
  files row and mints a presigned PUT URL (content-length/type are signed, so
  the 20 MB cap holds server-side-unseen); client PUTs the bytes straight to
  R2, then `POST /v1/files/:id/complete` verifies the object, generates image
  thumbnails/dimensions, and flips the row to `ready`. Pending files are
  neither attachable nor downloadable; stale ones are orphan-swept. On the
  local driver the presign response points at a server-proxied
  `PUT /v1/files/:id/content` fallback — same client code path. `[server] [web] [macos] [ios]`
- Downloads/thumbnails 302-redirect to short-lived presigned R2 URLs after the
  usual access checks (Range/video seeking served by R2); proxied as before on
  the local driver and for legacy encrypted rows. Native clients strip the
  bearer token when a redirect leaves the API host (S3 rejects dual auth);
  browsers do this per the fetch spec. `[server] [web] [macos] [ios]`
- Encryption posture change (operator ruling, see decision_log): R2-era file
  blobs are stored plaintext (R2 at-rest encryption + short-lived URLs);
  `enc_key_id` is now nullable and NULL means plaintext. Legacy encrypted
  blobs still decrypt; `FLOW_MIGRATE_BLOBS=1` runs the one-time
  decrypt-and-copy volume→R2 migration at boot (migration 0013). Message-body
  encryption is unchanged. `[server]`
- The legacy multipart upload endpoint still works (Slack-compat `files.upload`
  and old clients) and now writes plaintext too. `[server]`

### 2026-07-20 — Web: invite link defaults to Register
- A pending workspace invite now opens the auth screen on **Register** (email-first)
  instead of Sign In — invitees usually have no account yet. Explicit email-link
  tokens (signup/reset/signin) still take precedence. `[web]`
- Fixed a stale error lingering across the Sign In/Register toggle (a failed
  login's "invalid email or password" no longer shows on the Register view):
  form navigation now clears prior error/info. `[web]`

### 2026-07-20 — Web favicon
- Web client had no favicon (default browser globe); now ships one from the
  same icon source. `make-icon.swift`/`make-icon.sh` also emit
  `packages/web/public/favicon-{16,32,48}.png` + `apple-touch-icon.png`
  (rounded, no Dock shadow); `index.html` links them and sets `theme-color`. `[web]`

### 2026-07-20 — App icon (macOS + iOS)
- First real app icon for both native clients: violet gradient ground + white
  chat bubble carrying a two-line "flow" wave, matching the web "Quiet, in
  violet" brand (accent ≈ `oklch(0.46 0.19 300)`). Stays legible to 16px. `[macos] [ios]`
- Single CoreGraphics source (`apps/macos/tools/make-icon.swift`, run via
  `make-icon.sh`) emits the macOS `AppIcon.icns` (10-tile iconset → iconutil,
  rounded squircle + Dock shadow) and the iOS `AppIcon.appiconset` 1024 master
  (full-bleed; system-masked). Re-run only when the design changes. `[macos] [ios]`
- Wired in: macOS `make-app.sh` copies the icns + sets `CFBundleIconFile`; iOS
  `project.yml` sets `ASSETCATALOG_COMPILER_APPICON_NAME`. `[macos] [ios]`

### 2026-07-20 — Agent bridge: OTP-free npm publishing via GitHub Actions
- `.github/workflows/publish-bridge.yml`: on pushes to main touching
  packages/agent-bridge, publishes to npm via **trusted publishing (OIDC)** —
  no tokens stored, no OTP; skips when package.json's version is already on
  the registry, so a release is just "bump version + push". Requires the
  one-time Trusted Publisher registration on npmjs.com (repo
  scottpersinger/flow, workflow publish-bridge.yml). `[qa]` (release infra)

### 2026-07-20 — Agent bridge 0.2.4: full permissions by default
- Operator ruling: with neither `allowedTools` nor `permissionMode`
  configured, the claude runtime now runs with `--permission-mode
  bypassPermissions` — full access in its cwd. Setting either option opts
  into scoped permissions (and the wizard no longer writes a read-only
  `allowedTools` default). `[server]` (bridge tooling; npm 0.2.4)

### 2026-07-20 — Agent bridge 0.2.3: log to a local file
- Every daemon log line (same timestamped format as stdout) also appends to
  a log file — default `<config>.log` next to the config (agent.json →
  agent.log, chmod 600, parent dirs created), `logFile` config overrides
  (`~` expands), JSON `null` disables. One-shot rotation at 5 MB → `.log.1`;
  a broken log file degrades to stdout-only instead of crashing.
  `[server]` (bridge tooling; npm 0.2.3)

### 2026-07-20 — Agent bridge 0.2.2: transparent session recovery + saner max-turns
- Session-id collisions are now retried transparently in the same turn
  (flip to `--resume`, rerun the message — no error posted); an errored run
  that still emitted a result event (e.g. max-turns) marks the session
  resumable instead of colliding next turn. Default `maxTurns` raised
  25 → 100 — real coding tasks blew past 25, which was the root wedge:
  max-turns error → session exists → every later turn "already in use".
  `[server]` (bridge tooling; npm 0.2.2)

### 2026-07-20 — Invite emails + web invite links
- Inviting someone now actually emails them: "«Inviter» invited you to
  «Workspace» on Flow" with a web accept link, via the existing email seam
  (dev outbox locally, Cloudflare in prod). A failed send never fails the
  invite — the modal falls back to share-the-link-yourself and says which
  happened (`InviteDTO.emailSent`). Emailed links are always
  `FLOW_WEB_URL/invite/<token>`; prod also sets
  `INVITE_URL_BASE=https://app.flowtoo.org/invite/` so the admin-copied link
  matches (previously a browser-useless flow:// deep link).
- Web handles `/invite/<token>`: the token is stashed in localStorage
  (survives the register → confirm-email round trip), the auth screen shows
  a "you've been invited" banner, and the invite is accepted automatically
  on first sign-in, landing the user in the workspace. `[server] [web]`

### 2026-07-20 — macOS + iOS: 🤖 agent badge
- `User.isAgent` rides the shared data layer (Models + GRDB migration v6 +
  member sync); `displayNameWithBadge` badges display-only name maps, so the
  author line, DM header, sidebar DM rows, member list, thread panel,
  notifications, typing labels, mention pills, and the profile card all show
  the 🤖 — while mention *inserts* and accessibility ids keep plain names
  (outgoing mention resolution reads plain names from the DB). Mention
  autocomplete badges the popup/chip label only. No invite UI on macOS/iOS
  (web-only per ruling 4 — see Parity). `[macos]` `[ios]`

### 2026-07-20 — Web: 🤖 agent badge + agent admin UI
- Agent display names carry a small 🤖 everywhere names render: message
  author line, DM header + sidebar DM rows, mention autocomplete labels
  (insert stays the plain name), New DM / channel-invite member lists, and
  the user card (with an "AI agent" subtitle). "Invite an Agent…" in the
  workspace admin menu opens the Agents modal: mints a one-time invite key
  shown next to the server URL as a copy-paste pair, lists workspace agents,
  and offers admin Remove agent (confirm first — revokes tokens, keeps
  history). `[web]`

### 2026-07-20 — Inline markdown rendering (web)
- Message bodies now render inline markdown at display time: `code`,
  **bold**, *italic* (star and underscore), ~~strike~~, [label](url) links,
  and bare URLs — nested emphasis supported; code spans win over everything
  inside them; emphasis needs non-space edges so "2 * 3" and snake_case stay
  literal; fenced code blocks remain verbatim. Wire format unchanged (bodies
  stay literal markdown). Prompted by agent replies, which lean on inline
  markdown heavily. 15 render tests (react-dom/server). `[web]` — closes a
  previously-unlisted parity gap: macOS has had an inline attributed pass
  (mention pills + inline markdown) since phase 3.5; web only did blocks.

### 2026-07-20 — Regenerate agent token (lost agent.json recovery)
- Admin Agents modal: **Regenerate token** per agent —
  `POST /v1/workspaces/:id/agents/:userId/token` revokes all live tokens and
  returns a fresh one raw, shown once. The bridge setup wizard now accepts a
  `flow-agent-token-…` in place of an invite key (validates via /v1/me, skips
  registration, reconnects as the existing agent) — invite keys are
  single-use, so a lost config no longer forces a new agent identity.
  Answers AGENTS_DESIGN open question 3: regenerate is in v1 (operator
  request after hitting exactly this). `[server] [web]`

### 2026-07-20 — Agents always reachable in the DM list
- Workspace agents with no existing 1:1 DM now show as virtual rows under
  Direct Messages (presence dot + 🤖); clicking creates/opens the DM (server
  dedupes by dm_key). No more hunting through New DM to talk to an agent you
  just invited. `[web]` — macOS gap in Parity.

### 2026-07-20 — Mention-of-non-member CTA + channel members endpoint
- @mentioning someone who isn't in a standard channel now surfaces a banner
  above the composer — "X is not in this channel and won't see your mention"
  with **Add to channel** / Dismiss (Slack semantics; requested after an
  agent silently missed a mention in a channel it hadn't joined). After
  adding, a hint reminds you to re-mention (pre-join mentions aren't
  delivered — true for humans and agents alike). New
  `GET /v1/channels/:id/members` powers it; the channel-menu invite list now
  uses real membership too (it previously offered every workspace member on
  standard channels). `[server] [web]` — macOS gap in Parity.

### 2026-07-20 — Agent bridge 0.2.1: session self-heal after a failed first turn
- A first turn that died after the CLI created its session left the bridge
  retrying `--session-id <same uuid>` forever ("Session ID … is already in
  use" on every subsequent message). Failed first turns now rotate to a
  fresh session id — or flip straight to `--resume` when the error says the
  session already exists. `/reset` remains the manual escape hatch.
  `[server]` (bridge tooling; npm 0.2.1)

### 2026-07-20 — Agent bridge packaged as an installable tarball
- `pnpm pack` in packages/agent-bridge emits a standalone
  `flow-agent-bridge-<version>.tgz` (prepack builds; only runtime dep is
  `ws` — @flow/shared moved to devDependencies since all its imports are
  type-only). **Published to npm as `flow-agent-bridge` 0.2.0 (public, MIT)**
  — `npm install -g flow-agent-bridge` on any node 20+ host; renamed from
  @flow/agent-bridge (scope not ours), bin path normalized (npm silently
  drops `./`-prefixed bin entries), standalone README added (repo is
  private, so the npm page is the public doc). `[server]` (bridge tooling)

### 2026-07-20 — Agent bridge: incoming attachments reach the runtime
- Message attachments are downloaded (agent token, original bytes) to
  `$TMPDIR/flow-attachments/<agentUserId>/` and their local paths appended to
  the prompt — the CLI Reads them on demand and Claude renders images
  natively ("what's in this screenshot?" works). Failed downloads log and
  skip; copies persist so `--resume` references stay valid; demo runtime
  skips downloads. Pattern ported from the bizzybot agent-wrapper. `[server]`
  (bridge tooling)

### 2026-07-20 — Agent bridge daemon (packages/agent-bridge)
- New workspace package: consumes Flow events over the agent-token WS (real
  presence) and execs a coding-agent CLI headlessly per conversation.
  Session map (channelId, threadRootId) → `--session-id` / `--resume`;
  concurrent across conversations (cap N), serial within one; `/reset`
  clears the mapping. Claude runtime first (stream-json), codex stubbed.
  Thinking steps per operator ruling: one 🤖 *thinking…* status message
  posted on first tool_use, edited in place per tool call, deleted on
  completion (final reply posts fresh); typing indicator alongside;
  progress = thinking|typing|silent. MCP rich mode v1: bundled `flow`
  stdio server (send_message, react, upload_file, search_history) passed
  via --mcp-config. Safety: sender gating, self/agent loop guard,
  --max-turns + wall-clock timeout, per-agent permission flags. Fake-runtime
  e2e (scripts/e2e.mjs) covers the full DM/thread/reset/loop-guard matrix.
  Demo mode (`runtime.kind: "demo"`): no CLI spawn, always replies "Your
  message was received" — smoke-tests the invite→register→bridge→reply
  pipeline locally (operator request).
  One-command UX (operator request): bare `flow-agent-bridge` with no config
  runs an interactive setup — prompts for server URL + invite key, exchanges
  for the agent token, asks name/description/runtime/cwd, saves agent.json
  (0600), and starts the daemon; with a config present it just runs.
  Registration `name` now optional server-side (falls back to the invite's
  nameHint; agent self-identifies — operator ruling). Fixed: reconnect timer
  was unref'd, so a server restart made the daemon exit(0) instead of
  reconnecting.
  `[server]` (bridge is client-agnostic tooling; no client UI involved)

### 2026-07-20 — First-class AI agents: server identity + auth (AGENTS_DESIGN.md)
- Agents are real users (`users.is_agent`), invited by single-use key
  (`agent_invites`, 7d expiry, replay-rejected) via
  `POST /v1/workspaces/:id/agent-invites` (owner/admin) and registered
  unauthenticated via `POST /v1/agents/register` — creates the user row
  (synthetic email, unusable password), joins the workspace + #general, and
  mints a non-expiring revocable bearer token (`agent_tokens`).
  `authenticate()` now checks sessions first, then agent tokens. Role guard:
  agents are always plain members (workspace creation closed to them).
  Remove-agent (`DELETE /v1/workspaces/:id/agents/:userId`, admin) reuses the
  app-removal semantics — leave workspace + channels, delete 1:1 DMs, revoke
  tokens, keep the user row for authorship (extracted as a shared
  `removeMemberDeep`, deleteApp now delegates to it). `isAgent` added to
  UserDTO + WorkspaceMemberDTO everywhere users serialize. Migration 0012.
  `[server]`

### 2026-07-20 — Web: always open channels scrolled to the bottom
- Fix: opening a channel could land mid-list — MessageList was one reused
  instance across channel switches, so the previous channel's "am I pinned
  to the bottom" state carried over and the one-shot open-scroll fired
  before attachments laid out (the old refetch-per-open masked it; warm
  local-first caches made it the common path). The list now remounts per
  channel (`key={channelId}`, thread panel per root), resetting the pin and
  re-running the open scroll. `[web]`

### 2026-07-20 — Web: local-first send + apply-WS-events (perceived latency)
- Sending renders instantly: an optimistic pending row (dimmed, actions
  suppressed, attachments included) lands in the query cache before the POST
  leaves, reconciled by clientMsgId when the response or WS echo arrives —
  failures remove it and surface the composer error. Matches the macOS
  SyncEngine's pending-row behavior (parity gap closed; iOS shares the macOS
  engine). `[web]`
- message.created/updated/deleted/thread.reply events now apply their full
  DTO straight into the message/thread caches instead of refetching the whole
  list per event — receiving messages is instant too, and thread-reply
  rollups (count/lastReplyAt/participant stack, deduped across optimistic/
  response/echo) are mirrored client-side like macOS. Sidebar unread still
  rides the channels query. `[web]`
- Backdrop: prod DB moved to us-west (same-day migration) halved server time;
  this removes the remaining 2× round-trip wait. New vitest suite for the
  cache reducers (9 tests) — web's first test target. `[web]` `[qa]`

### 2026-07-20 — macOS: fix crash on video playback (AVKit not linked)
- Pressing play on a video attachment aborted the app: `swift build`
  autolinks the `_AVKit_SwiftUI` overlay but not `AVKit.framework` itself, so
  instantiating `VideoPlayer` died in the Swift runtime ("failed to demangle
  superclass of VideoPlayerView"). Explicit `.linkedFramework("AVKit")` in
  Package.swift; reproduced and verified fixed in an offscreen harness, and
  `otool -L` now shows both AVKit and the overlay. `[macos]`

### 2026-07-20 — UI nits: video sharing with inline playback
- `GET /v1/files/:id` now supports HTTP Range requests (`Accept-Ranges:
  bytes`, single-range 206s, 416 on unsatisfiable; multi-range served whole
  per RFC 9110) so video players can seek by URL. Video mimes were already
  accepted by upload; no poster/thumbnail generation (ruled — no ffmpeg-class
  dependency). `[server]`
- Inline video cards (mp4/mov/webm) with the phase-5/6 preview-card chrome:
  collapse chevron + filename header, hover Download, and a hover Expand
  that opens a full-window lightbox. Web uses native `<video>` controls over
  the authed blob cache (first frame doubles as poster; undecodable codecs
  fall back to the file chip). `[web]`
- macOS plays mp4/mov/m4v inline via AVKit behind a film play-button
  placeholder (video downloads on first play, ≤20 MB), with an expanded
  sheet consistent with the image lightbox (open-external/download/Esc).
  `.webm`/`.m4v` added to the upload mime map. `[macos]`

### 2026-07-20 — UI nits: app tokens viewable in Manage Apps
- Bot/app-level tokens are now viewable after creation: raw tokens stored
  alongside their auth hashes (migration 0011; PM ruling pending operator
  review — auth still verifies hashes only, and the DB already held the
  signing secret in plaintext). `GET /v1/apps/:id/credentials` (owner/admin)
  + `POST /v1/apps/:id/credentials/rotate` (regenerates both tokens, old
  ones stop authenticating). `[server]`
- Apps modal Configure section grows a Credentials block: bot token,
  app-level token, and signing secret in monospace with copy buttons
  (creation-reveal styling). Apps created before the migration show
  "created before token visibility — regenerate to view" with a
  confirm-guarded Regenerate button. App management stays web-only
  (existing ruled divergence). `[web]`

### 2026-07-20 — UI nits: thread-replies hover cursor
- Hovering the thread replies pill (avatars + "N replies") now shows the
  pointer/hand cursor: web adds cursor-pointer (Tailwind v4 preflight keeps
  buttons on the default cursor), macOS pushes NSCursor.pointingHand on hover
  (same pattern as the panel resize handles). `[web]` `[macos]`

### 2026-07-20 — UI nits: emoji search substring match
- Emoji shortcode search matches substrings of the name (not just the
  prefix), with prefix hits ranked first: shared `emojiMatches` (web
  `:shortcode:` composer autocomplete), macOS `EmojiCatalog.matches`
  (composer autocomplete), and the web/macOS/iOS picker grids share the same
  ranking. Unit tests added (vitest + XCTest). `[web]` `[macos]` `[ios]`

### 2026-07-20 — iOS files + unread polish, tiers 2–3 (phase 7)
- Attachment rendering in chat: image thumbnails with full-screen lightbox
  (original bytes + share sheet), animated GIFs (new ImageIO-backed
  AnimatedAuthImage), and name+size chips for every other type that open in
  QuickLook (text/PDF/media, share built in) — iOS-native equivalent of the
  phase-6 preview cards. `[ios]`
- Composer uploads: attach menu with PhotosPicker (multi-select; HEIC
  re-encoded to JPEG so server thumbnailing works), Files document picker
  (security-scoped copies), and Camera capture (stretch goal; hidden where no
  camera exists) — all through the existing engine.uploadFile pipeline, with
  a thumbnail/chip attachment bar + uploading state, sending fileIds like
  macOS. `[ios]`
- Unread polish: real app-icon badge (UNUserNotificationCenter badge count)
  for unread notifications, matching macOS dock-badge semantics; badge
  permission requested on sign-in, auto-skipped in DEBUG QA runs. `[ios]`
- Headless QA hooks for the upload pipeline: FLOW_DEBUG_UPLOAD /
  FLOW_DEBUG_UPLOAD_SEND. `[qa]`

### 2026-07-20 — iOS messaging parity, tier 1 (phase 7)
- Rich markdown message rendering: shared MarkdownBlocks segmentation
  (paragraphs / accent-bar blockquotes / fenced code blocks with horizontal
  scroll), mention pills via shared MentionRendering, day-divider pills,
  5-minute author grouping, edited/pending markers, shared AvatarChip. `[ios]`
- Long-press message actions (touch answer to the macOS hover menu): quick
  reactions, full emoji picker sheet (grid + search over shared EmojiCatalog),
  Edit (own, sheet editor), Delete (own, confirm dialog). `[ios]`
- Reactions: chips with counts under messages, tap to toggle, own-reaction
  highlight — shared SyncEngine mutations. `[ios]`
- Threads as a pushed screen: reply count + participant avatar stack on
  parents, ThreadScreen with root/divider/replies and its own reply composer;
  engine.openThread keeps reply backfill running across reconnects. `[ios]`
- Typing indicators: composer emits engine.typing; indicator row renders the
  shared AppState typing map (5s expiry) in channel + thread screens. `[ios]`
- Composer: @-mention autocomplete chip bar (group tokens + members). `[ios]`
- DEBUG-only headless QA hooks: FLOW_DEBUG_REACT / EDIT_LAST / DELETE_LAST /
  REPLY_LAST / OPEN_THREAD_LAST drive the exact engine paths the UI uses. `[qa]`

### 2026-07-20 — App removal (uninstall)
- Apps can now be removed, not just disabled: `DELETE /v1/apps/:id`
  (owner/admin) deletes the app row (credentials + queued event deliveries via
  cascade), removes the bot user from the workspace and its channels, and
  deletes 1:1 DMs with the bot. The bot's user row survives so message
  authorship keeps its name. Emits per-channel and workspace-level
  `member.left` so live clients drop the bot from member/mention lists and the
  DM from sidebars. `[server]`
- Manage Apps modal: "Remove…" button with inline confirm alongside
  Disable/Enable. `[web]` (app management stays web-only — ruled divergence)
- Workspace-level `member.left` (no channelId) now refreshes the member list,
  so a removed app's bot disappears from mentions immediately. `[macos]`

### 2026-07-20 — macOS composer wrap-width fix
- Fix: the composer could wrap text at a stale, too-narrow width (typing looked
  like it "erased" and restarted at the left — the field stayed one line tall
  while text wrapped onto an invisible second line). The NSTextView's wrap
  width could desync from the visible field after SwiftUI sizing probes or a
  resize; the scroll view now pins the document width to the clip width on
  every tile pass, `updateNSView` heals it on every render, and `sizeThatFits`
  answers SwiftUI's min/ideal/max probes explicitly instead of leaking stale
  frame widths. Verified in an offscreen layout harness (empty-state collapse,
  narrow/re-widen resize, long-wrap growth). `[macos]`

### 2026-07-20 — Passwordless sign-in link (magic link)
- Sign-in screen gains an "Email me a sign-in link" button: enter an email (no
  password) and we send a one-time link that logs an existing account straight
  in. Redeems via a `?signin=` URL param that auto-consumes on load. `[web]`
- Server: `POST /v1/auth/signin-link` (request, no-enumeration — always `{ok}`)
  and `POST /v1/auth/signin-link/consume` (redeem → session). Reuses the
  `email_tokens` machinery with a new `signin` purpose (migration
  `0010_signin_link.sql`, 15-min TTL). Unlike password reset it does **not**
  touch the password or revoke other sessions — it's an additional login;
  clicking the link also verifies a legacy-unverified address. `[server]`
- Extended `email-auth-e2e.mjs`: no-leak on unknown email, token delivery,
  consume→session, sessions-left-intact, single-use replay (23/23 pass). `[qa]`

### 2026-07-20 — iOS app: working vertical slice (new client)
- New `apps/ios` native SwiftUI client (iOS 17+), generated via xcodegen from
  `project.yml`. **Reuses the macOS app's entire platform-agnostic stack**
  (Models, APIClient, SocketClient, GRDB `AppDatabase`, `SyncEngine`,
  `AppState`, and cross-platform `Support/`) unchanged — only the touch UI and
  a UIKit `ImageLoader`/`Banners` shim are new. `[ios]`
- Slice that runs (verified in the iOS 17 simulator against both prod and the
  local QA server): sign-in → workspace switcher → channel + DM list (unread
  badges) → message list (authenticated avatars, @-mention rendering,
  timestamps, author grouping) → send a message round-tripping through the
  real server. `[ios]`
- Defaults to `https://app.flowtoo.org` (Server.swift resolution, same as
  macOS); `NSAllowsLocalNetworking` ATS exception allows the local http dev
  server while keeping prod HTTPS-enforced. DEBUG-only env hooks
  (FLOW_DEBUG_EMAIL/PASSWORD/OPEN_CHANNEL/SEND) allow headless simulator QA.
  `[ios] [qa]`
- Not yet ported (later increments): threads, reactions, files/previews,
  typing indicators, rich markdown, in-app registration. See Parity.

### 2026-07-19 — fix: avatars missing in web thread panel
- ThreadPanel rendered MessageList without `membersById`, so every avatar in a
  thread fell back to initials even when the user had a photo. Now passes
  `useMemberMap` like the channel view does. `[web]`

### 2026-07-19 — Slack Socket Mode compatibility
- Apps get an app-level `xapp-…` token at creation (hashed, one-time, shown in
  the Apps modal; migration 0009). `POST /api/apps.connections.open`
  authenticates with it and returns a one-time-ticket `wss://…/api/socket-mode`
  URL. `[server] [web]`
- The socket speaks Slack's protocol — `hello` frame, `events_api` envelopes,
  `{envelope_id}` acks, server pings for SDK stale-connection detection —
  verified with the official `@slack/socket-mode` client (new
  `scripts/socket-mode-e2e.mjs`, 9 checks). `[server] [qa]`
- Outbox delivery prefers a live socket (ack-confirmed) and falls back to the
  verified HTTP event URL; socket-only apps that are offline drop events after
  the normal retries (Slack semantics) but are never auto-disabled — that
  mechanism remains HTTP-endpoint-only. `[server]`
- Both WS endpoints (`/v1/ws` gateway + `/api/socket-mode`) now share one
  upgrade router (`gateway/upgrade.ts`) — two path-scoped `ws` servers on one
  HTTP server abort each other's handshakes. `[server]`

### 2026-07-19 — UI nits batch 2: bigger image previews, hover menu parity, edit/delete affordances, channel name+topic editing
- Inline image previews render ~2x larger (web cap 288×240 → 576×480 CSS px;
  macOS fit box 280×240 → 560×480). Server thumbs remain 512px max, so the
  largest previews are soft on retina; thumb pipeline deliberately untouched.
  `[web] [macos]`
- macOS gained the web-style message hover menu (overlay card: react,
  reply-in-thread, and edit/delete on own messages) alongside the existing
  context menu. `[macos]`
- Delete now asks for confirmation on both clients (web: small modal; macOS:
  AX-accessible confirmationDialog, also used by the context-menu Delete);
  web hover menu already had edit/delete. `[web] [macos]`
- ↑ in an empty composer starts editing your last message when it is the
  newest in the channel/thread (Slack semantics); Esc cancels. Message edit
  state on web moved into the selection context so the composer can start a
  row edit. `[web] [macos]`
- Clicking a channel's header name opens a name+topic editor; the topic shows
  as a sub-headline under the name (both clients already rendered it). New
  `PATCH /v1/channels/:id` (any channel member; `''` clears the topic;
  #general keeps its name; 409 on name collision) + `channel.updated` WS
  fan-out. No migration — the topic column existed since 0000_init.
  `[server] [web] [macos]`

### 2026-07-19 — macOS: configurable server URL (production support)
- Server resolution: `FLOW_SERVER_URL` env → `FlowServerURL` Info.plist (set by
  make-app.sh, defaults to https://app.flowtoo.org) → local dev fallback
  (127.0.0.1:8787, so `swift run` and QA profiles are unchanged). WS URL
  derived (https→wss). `[macos]`
- Per-server storage isolation: cache dir, Keychain slot, and prefs keys now
  suffix with the server host (empty for local — existing caches keep
  working); window title shows the server when non-local. `[macos]`
- Auth screen: shows the target server; on non-local servers the dev-only
  in-app Register is hidden in favor of a link to register on the web
  (email-first flow + app-link handoff). `[macos]`

### 2026-07-19 — Apps: signing secret surfaced at creation
- `POST /v1/workspaces/:id/apps` now returns `signingSecret` alongside
  `botToken` (both one-time; secret was previously generated + used to sign
  event deliveries but never shown to anyone, so integrators couldn't verify
  `X-Slack-Signature`). Apps modal shows both with copy buttons. `[server] [web]`
- New `APPS.md` documents the Slack-compat surface for integrators.

### 2026-07-19 — UI nits: thread shadow, first-open scroll, typing indicator
- Thread panel casts a subtle leading-edge shadow so it reads as floating over
  the main chat (Tailwind arbitrary shadow on web; background-shape shadow on
  macOS to keep it off the panel's text). `[web] [macos]`
- Opening a channel now lands fully on the newest message. Web scrolled on
  data arrival but late-loading attachments (images/text previews) grew the
  content afterwards — the list now stays pinned to the bottom
  (ResizeObserver) until the user scrolls away. macOS `scrollTo` from
  `onAppear`/`onChange` ran before the lazy rows were laid out and
  under-scrolled — replaced with `defaultScrollAnchor(.bottom)` (channel list
  + thread panel). `[web] [macos]`
- Typing indicator no longer lingers after the typist's message arrives:
  `message.created` / `thread.reply` now clear that user's typing entry on
  both clients. Web also had no expiry at all (the 5s filter only applied on
  unrelated re-renders, so "X is typing…" could stick around indefinitely) —
  added the timed sweep macOS already had. `[web] [macos]`

### 2026-07-19 — interactive fix: re-invite after accepted invite
- `UNIQUE(workspace_id, email)` on invites counted accepted invites, so an
  email could never be re-invited once its invite was used (hit when an
  account is deleted/recreated). Now a partial unique index on pending
  invites only (migration 0008) — matches the service's existing
  "one pending invite per email" semantics. `[server]`

### 2026-07-19 — Email-first registration (operator ruling)
- Register now takes only an email (`pending_signups` table, migration 0007 —
  no user row until the link is clicked); the emailed link opens a "finish
  your account" form (name + password) → `POST /v1/auth/register/complete`
  creates the account verified and signs in. `[server] [web]`
- Closes two holes in the password-first flow: register-time account
  enumeration (409 email_taken → now always "check your email"; existing
  accounts get a "you already have an account" note instead) and password
  pre-hijacking (credentials are only ever set by whoever proved address
  ownership). `[server]`
- `/v1/auth/verify-email` + `/resend` removed (resend = register again);
  login's `email_not_verified` gate kept for legacy rows, message now points
  at password reset. autoVerify one-shot path (dev driver only) unchanged —
  QA scripts and macOS untouched. `[server] [web] [qa]`

### 2026-07-19 — Cloudflare email driver wired
- `FLOW_EMAIL_DRIVER=cloudflare` now sends for real via Cloudflare Email
  Service REST API (flat `from`/`to` strings — not `{email}` objects; bounce
  + error surfacing). Needs `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_KEY`;
  from-address via `FLOW_EMAIL_FROM` (default noreply@mail.flowtoo.org).
  Server auto-loads repo-root `.env` (real env vars win). Verified with a
  live send. Local default remains the dev outbox driver. `[server]`

### 2026-07-19 — Email verification + password reset (phase-3 email flows, local-first)
- Email seam (`src/email/`, mirrors the blob-store seam): dev driver logs each
  message and drops it as JSON in gitignored `.emails/`; `FLOW_EMAIL_DRIVER=
  cloudflare` reserved for the deploy step (fails loudly until wired). `[server]`
- Registration now requires email verification: `POST /v1/auth/register`
  returns `{requiresVerification, email}` (no session); emailed link
  (`/?verify=<token>`, 48 h, single-use, sha256-hashed at rest in new
  `email_tokens` table, migration 0006) signs the user in on click. Login for
  unverified users → 403 `email_not_verified`. Existing accounts grandfathered
  verified; bot users created verified. `[server]`
- Dev/QA escape hatch: `autoVerify: true` in the register body — honored only
  on the dev email driver, never in production. QA scripts and macOS
  registration use it. `[server] [qa] [macos]`
- Password reset: `POST /v1/auth/password/forgot` (never leaks account
  existence) emails `/?reset=<token>` (60 min, single-use); reset sets the new
  password, revokes all sessions, and signs in fresh. `[server]`
- Web auth screen: register → "check your email" panel with resend; unverified
  sign-in shows the same panel; "Forgot password?" flow; `?verify=`/`?reset=`
  links handled at boot (verify auto-signs-in, reset shows new-password form).
  `[web]`
- New e2e: `scripts/email-auth-e2e.mjs` (15 checks: gating, single-use,
  resend invalidation, revocation, no-leak, autoVerify). `[qa]`

### 2026-07-19 — Renamed MyChat → Flow (deep rename)
- All user-visible naming: Flow.app (com.flow.macos), web title, UI strings.
  `[server] [web] [macos]`
- Internals too (operator ruling): @flow/* packages, FLOW_* env vars,
  flow.* localStorage keys, Keychain service ai.biztrip.flow, docker
  project/containers, Postgres role/db (data preserved via dump/restore),
  deep-link scheme myapp:// → flow://. All clients signed out once
  (re-sign-in via web CTA / flow://signin handoff). `[server] [web] [macos]`
- Leftovers (ruled): repo dir path, "MyChat Dev Signing" cert name,
  old-name mentions in historical docs.

### 2026-07-19 — Web-to-app auth handoff
- Web is the auth surface: signed-in web shows "Open the desktop app" CTAs
  (workspace-chooser button + dismissible top banner). `[web]`
- Clicking mints a one-time 2-minute code (`POST /v1/auth/app-link`, new
  `app_link_codes` table, migration 0005) and deep-links
  `myapp://signin?code=…`; the native app exchanges it
  (`POST /v1/auth/app-link/exchange`, single-use, replay-rejected) for its
  own session — raw tokens never ride in the URL. `[server] [macos]`
- macOS deep-link handler: signs out any existing session first (no
  cross-user cache mixing), then signs in as the code's user. `[macos]`

### 2026-07-19 — Phase 6: text + PDF file previews
- Text-ish files (mime `text/*`, JSON/JS/XML/sh/yaml, extension allowlist)
  render an inline monospace preview: first 10 lines, Expand/Collapse,
  expanded output capped at 100 KB with a visible truncation notice.
  `[web] [macos]`
- PDFs render a mid-size first-page preview; clicking opens an in-app full
  reader (browser-native `<embed>` on web — no pdf.js dep; PDFKit thumbnail
  + PDFView sheet on macOS) with open-external/download buttons.
  `[web] [macos]`
- All preview cards share the image-card chrome: chevron+name header,
  per-device collapse persistence, hover Download. `[web] [macos]`

### 2026-07-19 — interactive fixes (post-phase-5)
- Composer: clicking anywhere on the card (padding/whitespace) focuses the
  input — no longer requires hitting the text itself. `[web] [macos]`

### 2026-07-19 — Phase 5: attachment/image UX + thread panel
- Attachments: Download icon on hover (images, file chips, lightbox); macOS
  saves to ~/Downloads (uniqued) + reveals in Finder. `[web] [macos]`
- Animated GIFs play inline (original file for `image/gif`; macOS
  `AnimatedAuthImage` NSImageView wrapper). `[web] [macos]`
- Images: hide/show chevron + filename header; collapsed state persisted per
  device (capped 500). Open by default. `[web] [macos]`
- Clicking an image opens an in-app lightbox (original bytes) with
  open-external + download icon buttons; Esc/✕ closes. `[web] [macos]`
- Composer: pending image attachments show real thumbnails with ✕ overlay
  (files keep the name chip). `[web] [macos]`
- Thread panel width drag-resizable (double-click/tap resets; local pref,
  same ruling as sidebar width). `[web] [macos]`
- "N replies" affordance shows first-4 reply-author avatar stack; new
  `MessageDTO.replyParticipantUserIds` hydrated via DISTINCT ON (no
  `min(uuid)` in Postgres); macOS mirrors the rollup locally (GRDB v5
  migration). `[server] [web] [macos]`

### 2026-07-19 — interactive fixes (operator session)
- Code blocks: ``` auto-materializes an enterable block (fences hidden, caret
  inside); Return types code lines, Return on empty line submits, → exits the
  block, Esc/Delete removes an empty block. `[web] [macos]`
- Composer: drag-and-drop files attach (was: path text). `[web] [macos]`
- Emoji/mention autocomplete: vertical list, first match pre-selected,
  Enter/Tab inserts, arrows navigate, Esc dismisses. `[web] [macos]`
- Sidebar: Members section removed; persistent "<Name> (you)" self-DM;
  profile via DM context menu. `[web] [macos]`
- Active workspace persisted + restored; first open lands on #general. `[web] [macos]`
- macOS channel header: design-3a member avatar stack + "+N". `[macos]` (web already had it)
- Keychain: double prompt fixed (no token rewrite at bootstrap); stable
  "MyChat Dev Signing" identity — no prompts after rebuilds. `[macos]`

### 2026-07-19 — Phase 4: Slack app compatibility
- Admin-created apps, one-time xoxb- tokens, bot users as real users. `[server] [web] [qa]`
- 17 Slack Web API methods at POST /api/* (Slack envelopes/errors, ts codec,
  mrkdwn converter); verified with the official @slack/web-api SDK. `[server] [qa]`
- Events API: Postgres outbox, v0 HMAC signatures, retries, auto-disable,
  challenge verification; 10 event types. `[server] [qa]`
- Key-rotation CLI deferred to phase 3 (operator ruling).

### 2026-07-18/19 — Phase 3.5: features + design adoption
- Design 3a "Quiet, in violet" retheme. `[web] [macos]`
- User status (emoji + label): picker, sidebar/chat/footer display, live
  broadcast. `[server] [web] [macos] [qa]`
- Member-click opens DM; profiles via context menus + DM headers. `[web] [macos]`
- Footer split: avatar = user menu; rest = status picker. `[web] [macos]`
- Image paste into composer. `[web] [macos]`
- Workspace-wide sidebar color (8 presets, admin-set, live broadcast).
  `[server] [web] [macos] [qa]`
- Resizable sidebar (180–360, double-click reset, local pref). `[web] [macos]`
- Live in-composer markdown styling (> quotes, ``` fences) + styled message
  rendering; fence-aware mention/shortcode transforms. `[web] [macos]`

### 2026-07-18 — Phase 2: DMs, reactions, files, mentions, web client
- DMs (1:1/group), reactions, encrypted files + thumbnails, mentions incl.
  @channel/@here/@everyone, notifications + notify levels, membership
  management/archive, profiles (name/timezone/avatar). `[server] [web] [macos] [qa]`
- Web client (React 19 + Vite + Tailwind, online-only, Fastify-served). `[web]`
- macOS .app packaging (banners, myapp:// scheme). `[macos]`

### 2026-07-18 — Phase 1: foundation
- Backend (Fastify/Drizzle/Postgres/NATS/WS, encrypted messages, workspaces/
  channels/threads/unread/presence) + macOS SwiftUI client (SyncEngine, GRDB
  cache, optimistic send). `[server] [macos]`
