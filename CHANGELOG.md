# Changelog

Convention: every feature/fix entry tags the platforms it landed on —
`[server]` `[web]` `[macos]` `[ios]` `[bridge]` `[qa]`. A change that lands on one client
but not the others MUST add a line to **Parity** below (and remove it when
closed). Updated with every milestone commit (PM) and interactive-session fix
(coordinator).

Keep entries very succinct — one or two lines each: what changed, plus the why
only when it isn't obvious. Reasoning, investigation notes and file lists go in
the commit message, not here. This is a ledger to scan, not a narrative.

## Parity

### Gaps to close
- iOS: no join-link management (#85). Web + macOS can create/copy/regenerate/
  revoke the workspace's persistent join link from the invite surface; iOS has
  no invite surface at all to hang it on. Server API is done and client-agnostic
  (`/v1/workspaces/:id/join-link`), so this is a pure client port. Following a
  join link still works on iOS — it opens the web app, which redeems it.
- iOS: no build tag or "What's new" notes in the UI — web + macOS show the
  build's short commit SHA at the foot of the workspace menu, and clicking it
  opens a FEATURES.md lightbox. iOS has no workspace dropdown to hang either on;
  needs a home for them (an About/settings row) plus the plist/env plumbing.
- iOS: optimistic-send failures aren't recoverable — web + macOS keep a failed
  message in the stream with a Retry/Discard affordance (retry re-POSTs with the
  original `clientMsgId`); iOS still needs the `failed` flag on its message row,
  the un-bump/re-bump rollup handling, and the retry UI. Server is already
  idempotent on `(channelId, clientMsgId)`, so it's a client-only port.
- iOS: a thread-reply Activity notification lands in the originating channel
  but does not open the thread or scroll to the reply (web + macOS open the
  thread and flash the reply). iOS threads are a pushed screen owned by
  `ChannelScreen`'s `$threadRoute`; since #89 that route is seeded from
  `AppState.openThreadRootId` on appear, so the thread half is now plumbed —
  what's missing is an Activity row that sets `openThreadRootId` for a reply
  (it deliberately targets only top-level messages today) and the in-thread
  jump target, which `ThreadScreen` still ignores. Phase 12.
- Phase 11 unfurls: the §10 settings UI (per-user "don't unfurl my links",
  per-workspace switch/allowlist) is missing on *every* client — API-only.
- macOS: phase 10 notification settings — no Notifications section in the
  profile/settings UI (including the new per-user **Reactions** toggle), and the
  status picker doesn't set `status_suppress_alerts` (web shipped 2026-07-21).
  The shared `setStatus(emoji:text:suppressAlerts:)` now carries the flag and
  iOS sends it; macOS just needs to pass it at the call site. The banner path
  itself now honours the server's `suppressAlert` (2026-07-25, #63), so prefs
  set on web do take effect on macOS — only the settings surface is missing.
- iOS: no Notifications section in the account/profile UI (web shipped the
  per-user pref toggles in phase 10, plus the Reactions toggle 2026-07-25).
  Nothing on-device consumes them yet — iOS has no push notifications — so this
  closes with the APNs work.
- iOS: no Artifacts UI — no nested sidebar rows, artifact side panel, or
  pin-as-artifact action; the `artifact.*` WS events are safely ignored. Now
  the per-channel model (phase 13); server + web + macOS shipped together
  2026-07-23. Link artifacts (co-browsing mini-browser) likewise skip
  iOS — closes with the iOS artifacts port.
- Link-artifact mini-browser: the web client renders link artifacts in a sandboxed
  `<iframe>`, which has two browser limits the native macOS `WKWebView` doesn't:
  (1) sites sending `X-Frame-Options`/CSP `frame-ancestors` can't be embedded
  (web shows a best-effort "Open in new tab" fallback; macOS has no such block),
  and (2) the URL bar can't follow cross-origin in-page navigation (same-origin
  policy), so on web only URL-bar edits broadcast to co-browsers — in-page link
  clicks broadcast on macOS (navigation delegate) but not web. Typing a URL
  syncs everyone on both. Inherent to iframes; revisit only if we add a
  server-side page proxy.
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
  else in core messaging + files is now at parity. Now designed end-to-end in
  `docs/design/PUSH_APNS.md` (registry, sender seam, outbox, payload, client
  work, phasing) — that doc also carries the open operator questions:
  message body in the payload or not, the Apple Developer key, and
  sandbox-vs-production.
- macOS has no in-app registration, password-reset, or passwordless sign-in
  link against real servers — by design it links to the web (email-first flow +
  app-link handoff); the dev-only autoVerify register remains for the local dev
  server. (iOS same — auth is web-driven.)
- iOS: no inline video preview/playback card — video attachments render as a
  name+size chip that opens in QuickLook (which does play them); web/macOS
  render inline players with an expand affordance.
- iOS: typing indicator says "is typing…" even for agents; web + macOS show
  "is thinking…" for an agent at work (History 2026-07-22). The string lives in
  `ComposerView.swift`; the shared `AppState.agentIds` set is already populated
  on iOS (it reuses the macOS core) — it's a view-only switch.
- iOS: no member-profile popup at all — tapping another user's avatar does
  nothing (web + macOS open a profile card; macOS also shows an agent's
  "Sponsored by" row). Needs a new `MemberProfileSheet` on iOS plus avatar taps
  wired through `MessageListView`. `UserDTO.sponsorId` (shared) already carries
  the data.
- macOS + iOS: no per-channel scroll-position memory across channel switches —
  web only. macOS shipped a `.scrollPosition(id:)` implementation 2026-07-22
  that never actually tracked anything (the modifier only reports a position
  when the lazy stack is marked `.scrollTargetLayout()`, which it wasn't), so
  the memory was always empty and every channel switch landed at the bottom;
  the dead modifier was removed 2026-07-27 because it was blanking the
  transcript. Re-doing it on either client means marking the target layout and
  reconciling it with `.defaultScrollAnchor(.bottom)`, which owns the scroll
  position today. The shared `MessageScrollMemory` store is still there.
- iOS: the new channel drawer (2026-07-23) omits several sidebar affordances the
  web + macOS sidebars carry — a "new DM" composer, the virtual agent rows under
  Direct Messages (start a DM with a workspace agent that has no existing 1:1),
  the workspace color picker, and the Invite People / Manage Users / Manage Apps
  workspace-menu items. Channel context actions (mute/leave/archive, invite to
  channel) are also not yet wired on iOS. The drawer's structure makes these
  straightforward ports; none are backed on-device yet.
- macOS + iOS: message editing still uses an inline/dedicated edit field — web
  moved editing into the prompt editor (↑ and ✏️ load the body into the composer,
  Enter saves, Esc restores the draft; 2026-07-23 ui_nits). Both clients already
  have the PATCH plumbing; only the composer-reuse UX needs porting.
- macOS + iOS: the self-DM row still shows an unread badge — web fixed this
  2026-07-23 (ui_nits). Client-only sidebar tweak. (DM alphabetical sorting was
  closed on both clients 2026-07-24.)
- iOS: no **Invite your Agent** CTA (phase 15) — web and macOS have a sidebar
  button + dialog that mints a one-time invite code (`npx flow-agent-bridge
  <code>`) above the profile footer. iOS can't yet generate a code, so onboarding
  an agent from a phone still means grabbing the code from another client.
  Closes when iOS ports the `POST /v1/workspaces/:id/agent-invites` call + the
  display sheet. No approval surface is needed any more (redemption is
  immediate). (macOS ported 2026-07-26.)

- macOS: no passwordless "Email me a sign-in link" button — web + iOS have it
  (iOS added 2026-07-24). The shared `SyncEngine.sendSigninLink` is already there,
  so it's a UI-only add on the macOS `AuthView`.
- iOS: the emailed sign-in link opens the **web** (`app.flowtoo.org/?signin=…`),
  not the native app — tapping it signs in on web, then the flow://signin handoff
  can bring you into the app. A one-tap native flow needs **Universal Links**:
  an `apple-app-site-association` served by the server (scoped to a distinct
  sign-in path), an Associated Domains entitlement (`applinks:app.flowtoo.org`)
  with the capability enabled on the App ID, and in-app consumption via
  `POST /v1/auth/signin-link/consume`.

- iOS: the channel header avatar stack is still decorative — web and macOS make
  it open a member list (names, presence, status, tap-through to the profile
  card) as of 2026-07-25 (#70). iOS's header is a different construction with no
  stack to hang it on, so it needs a members affordance chosen for the phone
  (a header button or a row in the channel sheet) plus the
  `GET /v1/channels/:id/members` fetch both other clients now use.

### Deliberate divergences (ruled)
- Google sign-in on macOS/iOS goes through the **browser handoff**, not a native
  SDK: the native button opens the system browser at `/?native=google`, which
  runs Google Identity Services, calls `POST /v1/auth/google`, mints a one-time
  app-link code and returns via `flow://signin?code=…`. Web runs GIS in-page.
  Same server endpoint, same session, no Google SDK or new OAuth client on
  native — and it reuses the handoff the "Open the desktop app" button has used
  since phase 3. A fully in-app flow (`ASWebAuthenticationSession` / Google
  Sign-In SDK posting the ID token directly) would need an iOS/macOS OAuth
  client id added to the accepted `aud` set; worth doing only if the browser
  round-trip proves unpopular.
- Copy message text: explicit "Copy" item in the message menu on iOS + macOS
  (their custom Text rows aren't natively selectable); web omits it because
  browser text selection + Cmd/Ctrl-C already copies message text.
- Emoji picker: custom grid + search on web and iOS (reaction sheet); native
  character palette on macOS.
- iOS composer: plain text + @-mention autocomplete only — no live-styled
  fence/code composer (PM ruling per phase7.md recommendation, pending
  operator review). Markdown still renders fully; sugar expands at send time.
- Mention/emoji typeahead presentation: web + macOS float a vertical list over
  the transcript above the composer; iOS keeps its inline horizontal chip row
  (keyboard-driven reflow is native there, and its list never had the macOS
  scroll-blanking bug).
- iOS message actions: long-press context menu (no hover on touch).
- Link cursor (#81) and hover-menu tooltips (#110): macOS only. The browser
  gives web both for free, and touch has neither a cursor nor hover.
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
- Responsive/mobile layout (drawer nav, viewport-capped media and modals):
  web only, and inherently so — the native clients lay themselves out per
  platform, and the iOS app is the native phone experience. Not a gap.

## History

Archived by phase — the live file keeps only the Parity ledger and entries for
work after phase 16.

| Archive | Span | Contents |
|---|---|---|
| `CHANGES_ARCHIVE_PHASE1-11.log` | through 2026-07-22 | phases 1-11, up to and including URL unfurling |
| `CHANGES_ARCHIVE_PHASE12-16.log` | 2026-07-22 → 2026-07-26 | phases 12-16: #Activity feed, artifacts, signed macOS distribution, agent invites, Sign in with Google |

Entries below start after phase 16.

### 2026-07-28 — iOS distribution: new Apple account, first TestFlight upload

- `[ios]` Signing moves to the new Apple team (`RP5QYMYA4Z`) with bundle id
  `im.freeflow.app` (supersedes the org.flowtoo.* ruling — nothing had shipped
  under the old id; see decision_log 2026-07-28). First build uploaded to App
  Store Connect; release lane recorded in BUILD.md + `ExportOptions.plist`.

### 2026-07-28 — Jump to latest, link cursor, hover-menu tooltips

- `[web]` `[macos]` `[ios]` A "Latest msgs ↓" pill appears while you're reading
  back-scroll and jumps to the newest message (#111). The native clients also
  stop following new messages down unless you're already at the bottom — web
  already worked that way, and without it the button never stays up.
- `[macos]` Hand cursor over hyperlinks in messages, unfurl cards and
  link-styled buttons (#81). SwiftUI hit-tests nothing inside a `Text`, so the
  paragraph is re-laid with TextKit to find the link rects.
- `[macos]` Message hover-menu buttons draw their own tooltip after 350ms
  (#110): AppKit help tags never appeared on a pill that only exists while
  hovered, and the system delay outlasts the hover anyway.
- VERSION → 2.2.6.

### 2026-07-28 — Typeahead floats above the composer (macOS)

- `[macos]` The @-mention/emoji typeahead now floats over the transcript
  (web parity) instead of growing the composer — the resize was #97's
  surviving trigger for the message list scrolling blank. VERSION → 2.2.5.

### 2026-07-27 — Activity is per workspace

- `[server]` `[web]` `[macos]` `[ios]` Activity now shows only the selected
  workspace's rows. `/v1/me/notifications` takes an optional `workspaceId`
  (absent = the old global feed, so shipped clients keep working), and its
  `unreadCount` follows that scope; a new `totalUnreadCount` keeps the OS app
  icon badge counting every workspace.
- `[server]` A cursor sweep (`upToId`) now takes a `workspaceId` too, so
  opening Activity in one workspace can't mark another's older rows read.

### 2026-07-27 — macOS 2.2.3

- `[macos]` Bump `apps/macos/VERSION` to 2.2.3 to ship the mid-session 401
  sign-out. Merging doesn't release macOS; the DMG is cut by hand.

### 2026-07-27 — Repo moved to `freeflow-community/flow`

- `[docs]` Repo moved to `freeflow-community/flow`; every in-repo reference
  follows (docs, `agent-bridge`'s `repository.url`, workflow comment, landing
  site). Archive logs keep the old name as history.
- `[docs]` README's Issues/Discussions links are absolute — root-relative
  `/issues` resolved against the blob path and 404'd.
- Still owed outside the repo: npm's trusted-publisher config and Railway's
  GitHub source both still name the old owner.

### 2026-07-27 — README screenshot

- `[docs]` README banner is now a screenshot of the web client
  (`docs/images/flow-web-general.png`) instead of the ASCII wordmark.
- `[docs]` README's License section trimmed to a link to `LICENSE.md`. Terms
  unchanged; they're just no longer restated in two places.

### 2026-07-27 — An expired session signs you out instead of breaking one action

- `[macos]` `[ios]` A 401 mid-session now signs you out with a reason, instead
  of failing whatever action hit it. 401 was only handled at launch, so a dead
  session showed up as "Couldn't paste image: invalid or expired token" while
  the app read on from cache. `APIClient` gained an unauthorized handler;
  `SyncEngine` tears the session down. Also covers the offline-start path,
  which begins from cache with an unvalidated token.
- No parity gap: iOS compiles the same `Networking`/`Sync`/`AppState` sources.

### 2026-07-27 — A real join page behind a join link (#85)

- `[web]` `/join/<slug>/<token>` now lands on a page that names the workspace
  and asks, instead of redeeming silently and dropping you on the app home
  page. New `JoinScreen`: signed out it wraps `AuthScreen` with the workspace
  name; signed in it confirms, or offers to open the workspace if you're
  already a member; a dead token says so. First caller of the preview endpoint
  `GET /v1/join-links/:token`, which existed for this.
- `[web]` The pending-join stash expires after 24h — it now drives a
  full-screen page, so a forgotten token would hijack the next visit.
- No parity gap: macOS and iOS follow join links by opening the web app. (iOS
  still lacks join-link *management* — that entry stands.)

### 2026-07-27 — signed-out screen

- `[web]` Remove the "Bring your AI agent to Flow" skill-download card from the
  signed-out auth screen (operator request). The signed-out page is now just
  the sign-in box and the Mac app download link. The asset itself is untouched:
  `skills/flow-agent-member/SKILL.md` is still copied to
  `/flow-agent-member-SKILL.md` on predev/prebuild and still served, so any
  existing link to it keeps working — only the CTA is gone. Nothing to mirror
  on macOS or iOS; neither native auth screen ever carried the card.

### 2026-07-27 — macOS scroll blanking

- `[macos]` Fix the message list blanking whenever the composer changes height
  (attachment tray appearing, a draft wrapping to a second line). The list
  carried two competing scroll drivers — `.defaultScrollAnchor(.bottom)` and a
  `.scrollPosition(id:)` feeding `MessageScrollMemory`. On a container resize
  they disagreed, the content height ballooned ~2.6x (measured off the
  scrollbar thumb in the operator's recording: 391px while blank vs 1009px
  after recovery) and the bottom anchor followed it into space with no rows in
  it, so the transcript went blank until the user scrolled back. Removed the
  `.scrollPosition(id:)` driver. Nothing was lost: it never tracked anything
  (see the Parity note), so scroll memory on macOS was already inert. The
  thread panel and both iOS lists only ever used the bottom anchor, which is
  why the bug was specific to the macOS channel list.
- `[macos]` Guard the `UNUserNotificationCenter.current()` call in
  `applicationDidFinishLaunching` with `Banners.available`, the same bundle
  check every other UserNotifications call site uses. `current()` traps when
  the process has no bundle identifier, so a bare `swift run Flow` aborted
  before the window appeared. Nothing is lost unbundled — banners can't be
  delivered there, so the delegate has no tap to route.

### 2026-07-27 — macOS 2.2.1
- `[macos]` Bump `apps/macos/VERSION` to 2.2.1 so the thread-parking fix (#89)
  can ship. 2.2.0 (build 287) was published before #89 merged, and the macOS
  pipeline is manual — merging to `main` does not release the app, unlike
  `flow-agent-bridge`. Sparkle compares `CFBundleVersion` (the commit count, so
  it always increases), but the release notes users see are keyed to the short
  version, and reusing 2.2.0 would show the same version twice in the feed.
  Cutting the build still needs a local `dist.sh` + `publish-dmg.sh` run with
  the signing identity and notary profile.

### 2026-07-27 — An open thread survives a channel switch (#89)
- `[web]` `[macos]` `[ios]` Switching channels used to close the open thread:
  the thread lives in a single selection slot (`threadRootId` /
  `openThreadRootId`) and `selectChannel` cleared it unconditionally, so a
  detour to another channel — or a notification banner — lost your place in a
  conversation with no way back but re-finding the root message. Channel
  switches now **park** the thread instead: the channel being left records what
  it had open, and the channel being entered reopens whatever it had. Session-
  scoped and in-memory (a `ThreadMemory` map on web, `openThreadByChannel` in
  `AppState`), cleared on workspace switch, sign-out, and when a channel is left
  or archived; nothing new is persisted, so a reload still starts clean.
- `[web]` `[macos]` Opening an artifact in a *different* channel now swaps the
  thread tab along with the channel. It used to change the channel behind the
  panel while leaving the previous channel's thread mounted as a live Thread
  tab — and on macOS the engine's copy of the selection had already been reset,
  so that thread silently stopped backfilling.
- `[macos]` An Activity/banner jump to a top-level message now explicitly closes
  the target channel's thread rather than only opening one for thread replies —
  with threads parked per channel, a restored thread would otherwise hide the
  message being jumped to (`ChannelView` suppresses the focus target while a
  thread is open).
- `[ios]` The close-the-thread hook moved from `ThreadScreen.onDisappear` to
  `ChannelScreen`'s `threadRoute` binding. `onDisappear` also fires when a
  channel switch replaces the stack root, which is exactly the case that must
  park the thread rather than close it; the binding only changes on a real
  Back/swipe pop, and `ChannelScreen` seeds it from `AppState` on appear to
  re-push a parked thread.

### 2026-07-27 — Agent turns expire on silence, and survive expiring
- `[bridge]` Published as **0.12.0**. Running bridges keep their old behaviour
  until operators update — the startup staleness check nags them to.
- `[bridge]` A killed turn no longer loses its session. The "is this session
  resumable" test was `sawResult` — the *terminal* result event, which a killed
  run never emits — so an expired first turn fell through to
  `conv.sessionId = randomUUID()` and discarded the uuid the CLI had been
  writing a transcript under. The next message then started cold: chat history
  but none of the agent's own context, with its half-finished edits still on
  disk and unmentioned. `RunResult.sawResult` becomes `sawSession`, set by *any*
  well-formed stream-json event (`StreamJsonParser.sawEvent`) — the CLI only
  emits those once the session exists, so it proves resumability without
  needing the run to finish. A runtime that dies before emitting anything still
  rerolls to a fresh id.
- `[bridge]` A failed turn now posts what the agent managed to say. The parser
  was reading assistant `text` blocks off the wire and dropping them (only
  `tool_use` was kept, for the status line), and `finalText` was populated
  solely by the result event — so an expired run had nothing to salvage even in
  principle. `StreamJsonParser.lastText` now keeps the newest assistant text,
  expiry resolves with it (codex: raw stdout), and `failureReply()` posts it
  under a "Where I got to:" heading, capped at 4000 chars against the API's
  12000-char body limit. Since the runtime's own words now ride along as
  salvage, the error string no longer splices `finalText` in truncated at 300
  chars.
- Together these close the hole where an expired turn left no trace anywhere:
  no reply, no status line (`progress.finish()` hard-deletes it by design), and
  no resumable session.

### 2026-07-27 — Agent turns expire on silence, not on the clock
- `[bridge]` A runtime turn was capped at a flat `timeoutSec` (600) wall clock
  armed at spawn and never reset — a turn actively streaming tool calls at 9:59
  was SIGKILLed exactly like a wedged one, and real multi-hour coding work died
  at ten minutes with the whole turn discarded.
- New `runtime.idleTimeoutSec` (default **120**) is now the operative limit: the
  timer is rearmed by every byte on stdout/stderr. stream-json narrates each
  tool call, so a run that is still working can never expire, however long it
  takes; only genuine silence — a CLI blocked on a prompt it can't get — ends
  it. `timeoutSec` survives as the absolute runaway backstop and its default
  moves 600 → **3600**. Both are validated positive at config load, since a `0`
  would expire every run at spawn.
- Expiry now kills the **process group**, not the CLI process. Runtimes spawn
  `detached: true` and expiry sends `SIGTERM` to `-pid` (escalating to
  `SIGKILL` after 5s, so the CLI can flush the session transcript that makes
  the next turn resumable). Previously a bare `child.kill()` reached only
  `claude`, orphaning whatever its Bash tool had started — builds, test runs,
  dev servers kept running unsupervised forever. The flip side of `detached` is
  that runtimes no longer die with the daemon, so `AgentBridge.stop()` calls a
  new `killAllRuntimes()`.
- Error text now names the limit that fired (`no output for 120s` vs `hit the
  3600s run cap`) — they need different fixes, so the message says which.
- Docs: `AGENT_MEMBERS.md` had been claiming a 300s default since before it was
  600; both it and the bridge README now match the code.

### 2026-07-27 — Retired-hostname redirect, in the app rather than at the CDN
- `[server]` New `FLOW_REDIRECT_FROM_HOSTS` (comma-separated, **empty by
  default**): a request arriving on one of those hostnames 302s to the same
  path on `FLOW_WEB_URL`. This is phase17 §13's retirement window — the old and
  new hostnames resolve to the same service, so the redirect keys off the Host
  header in an `onRequest` hook, before routing and before body parsing.
- Config-driven rather than hardcoded: `app.flowtoo.org` has no business being
  compiled into a server other people self-host, and unset means the hook is
  never installed.
- **`/v1` and `/api` are exempt.** A 302 on a POST is replayed as a GET by most
  clients, and the WebSocket upgrade at `/v1/ws` cannot follow a redirect at
  all — redirecting those would make old native clients go quiet, which reads
  as an outage rather than a migration. They keep working on the old hostname
  until its DNS is dropped, then everything stops together. `/download/*` is
  deliberately **not** exempt: that is how an installed macOS app reaches the
  new appcast, and Sparkle follows redirects.
- Loop guard: an entry naming the canonical host itself is dropped with a
  warning, since honouring it would 302 the live host to itself.
- Chosen over a Cloudflare redirect rule, which would have required flipping
  the record to proxied and the zone to Full (strict) — putting Cloudflare in
  front of a Railway-issued cert it then has to keep renewing, plus a new
  request-body ceiling. Operator call: not worth it for a few weeks.
- New `packages/server/test/retiredHost.test.ts` (8 cases): off-by-default,
  path+query preserved (emailed `/?signup=<token>` links with the old host are
  still live), canonical host untouched, the `/v1` `/api` exemptions, `/download`
  redirected, list parsing, the loop guard, and Host-header port stripping.
- Documented in both `DEPLOYMENT.md` (self-hosting) and `docs/ops/DEPLOYMENT.md`.
  Not enabled yet — shipping it is inert until the variable is set.

### 2026-07-27 — Fix: Sparkle deltas were advertised but never served
- `[server]` `[macos]` `generate_appcast` writes `<enclosure>` entries for the
  binary deltas it produces, but **neither end could deliver them**:
  `publish-dmg.sh` globbed `Flow-*.zip` only, so deltas never reached R2, and
  the server's allowlist (`UPDATE_ASSET_RE`) admitted `appcast.xml` and
  `Flow-<ver>-<build>.zip` only — deltas are `Flow<to>-<from>.delta`, with no
  hyphen after `Flow`, so they were refused even once uploaded.
- Effect was invisible: Sparkle falls back to the full archive when a delta
  404s, so **every** delta-eligible update quietly pulled ~5 MB instead of
  ~500 KB. Found while verifying the re-domain publish, not by a failure.
- `[server]` Allowlist gains `Flow<digits>-<digits>.delta`, served as
  `application/octet-stream`. Deliberately still a tight pattern — the route
  must never become a read primitive for arbitrary blob keys.
- New `packages/server/test/updateAssets.test.ts` (4 cases): the route had
  **no test coverage at all**, which is why this survived. Pins the shapes that
  must be served (feed, archives, deltas) and the ones that must stay rejected
  (traversal, `Flow.dmg`, suffixed lookalikes like `…zip.enc`).
- Also corrected one stale `app.flowtoo.org` delta URL that `generate_appcast`
  had carried forward from the previous feed into the re-domained one.

### 2026-07-27 — bridge: bump to 0.11.0 to publish the new default host
- `[bridge]` The re-domain changed the default `serverUrl` to
  `https://app.freeflow.im`, but agents install via `npx flow-agent-bridge`, so
  the code landing on `main` ships nothing on its own — same reason 0.6.0 and
  0.10.0 needed their own bumps. Minor rather than patch: anyone relying on the
  default host gets a different server.
- Publishing is automatic (`.github/workflows/publish-bridge.yml`, npm trusted
  publishing over OIDC) — the push that touches `packages/agent-bridge/**`
  publishes because 0.11.0 isn't on the registry yet.
- Agents that already ran setup keep the old host in their on-disk config until
  setup is re-run; upgrading the package alone does not move them.

### 2026-07-27 — Fix: the iOS target couldn't compile (Sparkle leaked in)
- `[ios]` The iOS target pulls in `../macos/Sources/Flow/Support` wholesale,
  excluding only `Banners.swift`. `Updater.swift` landed there with Sparkle
  auto-update (`82fa540`, phase 14) and `import Sparkle` has no iOS module, so
  **every iOS build since that commit failed** with "Unable to find module
  dependency: 'Sparkle'". Added it to the excludes alongside `Banners.swift`.
  Nothing shared references `Updater`, so the exclusion is inert for macOS.
- Found while rebuilding both clients for the re-domain; unrelated to it. No
  Parity line — this is a build break, not a feature that shipped one-sided.
- `xcodebuild -scheme Flow` clean; the built bundle stamps
  `FlowServerURL = https://app.freeflow.im`.

### 2026-07-27 — Re-domain: flowtoo.org → freeflow.im (repo side)
- `[server]` `FLOW_EMAIL_FROM` default → `noreply@mail.freeflow.im`; the unfurl
  bot User-Agent now points at `https://app.freeflow.im/bot`.
- `[macos]` `[ios]` The server URL stamped into builds → `https://app.freeflow.im`
  (`make-app.sh`, `dist.sh`, `publish-dmg.sh`, `project.yml`). On macOS that also
  moves `SUFeedURL`, so a rebuilt app polls the new appcast.
- `[bridge]` Default `serverUrl` → `https://app.freeflow.im`. Needs an npm
  republish to reach `npx` users; agents that already ran setup keep the old
  host in their on-disk config until re-run.
- `[qa]` **Both native clients will present as signed out** after this lands:
  `Server.storageSuffix` keys the Keychain slot, cache DB and UserDefaults
  namespace off the hostname, so the new host addresses an empty namespace. The
  old state stays on disk, just unread. Deliberate — see `decision_log.md`.
- Bundle ids (`org.flowtoo.*`) are **unchanged and staying that way**; they are
  identifiers, not URLs. Docs edits touched URL references only.
- Spec: `docs/specs/phase17.md` (operator steps for DNS, Railway, email, OAuth
  and R2 — none of which this commit performs). `DEPLOYMENT.md` retopologised;
  its two contradictory CNAME targets replaced with "read it from Railway".
- Web needed no changes (served same-origin, hardcodes nothing).
- `pnpm -r build` + `swift build` clean; `pnpm -r test` green (310 tests).

### 2026-07-26 — Feature: persistent, revocable workspace join links (#85)
- `[server]` New `workspace_join_links` table (migration 0025) — primary key on
  `workspace_id`, so a workspace has at most one live link and regenerating
  *is* revoking. No expiry: the emailed invite covers "one address, one use",
  this covers "paste it in a doc and leave it there".
- `[server]` The token is stored **in plaintext**, the only token in the schema
  that is. A persistent link has to be re-readable next month, which a one-way
  hash makes impossible. It grants exactly one capability (become a member of
  this workspace), dies on one click, and only owners/admins can read it — the
  same permission that gates sending invites. Reasoning is in the migration.
- `[server]` The token is **16 bytes / 22 characters**, not the 32-byte
  `newToken()` the rest of the schema uses — new `newLinkToken()`. This is the
  only token a person reads off a screen and pastes into a document, and 22
  characters keeps the whole URL on one line in a chat client. 128 bits is
  still far past guessing, and the two endpoints that accept a token are now
  rate-limited: preview at 60/IP/10min (loose — a link in a busy channel means
  many real people behind one NAT address) and redeem at 20/user/10min (keyed
  by user, since redeeming already costs an account). Preview is the one that
  matters: unauthenticated plus an unhashed token makes it the only guessing
  oracle on this surface.
- `[server]` `GET`/`POST`/`DELETE /v1/workspaces/:id/join-link` (owner/admin;
  non-members get 404 for membership privacy), plus unauthenticated
  `GET /v1/join-links/:token` so the landing page can name the workspace before
  the visitor has an account, and `POST /v1/join-links/redeem`. Redeem goes
  through the existing `enrollInWorkspace` + `announceJoin` path, so joining by
  link is indistinguishable downstream from accepting an invite — and is
  idempotent for someone who is already a member (no second join message).
- `[server]` `[web]` `[macos]` The shared URL is
  `<WEB_URL_BASE>/join/<workspace-slug>/<token>`. The slug is decoration for
  the human reading it; only the token is matched server-side, so a link
  carrying a stale slug still works.
- `[web]` The **Invite People** dialog gained a *Share a join link* section —
  create / copy / regenerate / revoke. It renders nothing for non-admins (the
  `GET` 403s and the section hides itself), and sits below both the email form
  and the post-send result, because the link belongs to the workspace, not to
  one invite.
- `[web]` `/join/<slug>/<token>` stashes the token in `localStorage` and
  redeems it once a user is signed in — the same survive-the-signup-round-trip
  trick as the emailed invite. An invalid link now says so in the banner
  instead of failing silently. New `lib/joinLink.ts` (`parseJoinPath`).
- `[macos]` Same section in the invite sheet, gated the same way; new
  `SyncEngine.joinLink/createJoinLink/revokeJoinLink` and `JoinLinkResponse`.
  Redemption stays web-side — the link is an `http(s)` URL and opens there.
- New `packages/server/test/joinLinks.test.ts` (17 cases): the link reads back
  identical across calls (it's persistent, not shown-once), regenerating
  invalidates the previous URL, revoke + double-revoke, multiple people redeem
  the same link, idempotent for an existing member and role-preserving for the
  owner, and the 403/404 permission split. The token length is pinned exactly
  (22 chars / 16 bytes, URL-safe alphabet, no repeats across 20 mints) because
  the temptation is to "fix" it back to the house 32-byte token, and the
  rate-limit policy is pinned at the numbers the handlers pass. Plus 4 web
  cases for the URL parse.
- `[ios]` Not ported — see the Parity gap added above.
