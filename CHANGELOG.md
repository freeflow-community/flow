# Changelog

Convention: every feature/fix entry tags the platforms it landed on —
`[server]` `[web]` `[macos]` `[qa]`. A change that lands on one client but not
the other MUST add a line to **Parity** below (and remove it when closed).
Updated with every milestone commit (PM) and interactive-session fix (coordinator).

## Parity

### Gaps to close
- Web composer: browser-native undo degrades after programmatic splices
  (autocomplete/suggestion inserts) — contenteditable limitation; macOS undo is clean.
- macOS: pasting a non-image file URL inserts its path as text; web handles
  arbitrary files via drop/picker. (Drag-drop attach works on both.)
- Web: one session token per browser origin — two accounts in two tabs collide
  (macOS profiles handle multi-account). Candidate phase-3-adjacent fix.
- macOS: workspace-chooser tiles ignore AX activation (real click required) — a11y gap.
- No syntax highlighting in code blocks (both clients; never scoped).
- macOS has no email-verification or password-reset UI; its in-app register
  relies on the dev-only `autoVerify` bypass. In production, registration and
  reset go through the web (+ app-link handoff) until macOS closes this.

### Deliberate divergences (ruled)
- Emoji picker: custom grid + search on web; native character palette on macOS.
- App management UI (Slack-compat apps): web only.
- Local per-device (not synced) prefs: sidebar width, thread-panel width,
  image collapsed/expanded state (ruled).

## History

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
