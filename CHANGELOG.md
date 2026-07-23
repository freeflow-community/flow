# Changelog

Convention: every feature/fix entry tags the platforms it landed on —
`[server]` `[web]` `[macos]` `[ios]` `[bridge]` `[qa]`. A change that lands on one client
but not the others MUST add a line to **Parity** below (and remove it when
closed). Updated with every milestone commit (PM) and interactive-session fix
(coordinator).

## Parity

### Gaps to close
- macOS: clicking an OS notification banner does not navigate to the message —
  web now focuses the tab and jumps to the triggering message on banner click
  (2026-07-23), but the native app's `Banners.show` fires a
  `UNUserNotificationCenter` request with no `UNUserNotificationCenterDelegate`,
  so `didReceive` is never handled and a click just activates the app. Needs a
  delegate that routes the notification `id` to the same jump `AppState` already
  does for Activity-row taps. (iOS has no push notifications yet — closes with
  the APNs work.)
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
  thread and flash the reply). iOS threads are a locally-owned pushed screen
  (`ChannelScreen`'s `$threadRoute`), not driven by `AppState`, so the channel
  push carries neither the thread route nor the in-thread jump target — the
  Activity row deliberately sets `focusMessageId` only for top-level messages
  there. Needs the thread route + focus threaded through. Phase 12.
- Phase 11 unfurls: the §10 settings UI (per-user "don't unfurl my links",
  per-workspace switch/allowlist) is missing on *every* client — API-only.
- macOS: phase 10 notification settings — no Notifications section in the
  profile/settings UI, banner path doesn't consult `suppressAlert` yet, and
  the status picker doesn't set `status_suppress_alerts` (web shipped
  2026-07-21). The shared `setStatus(emoji:text:suppressAlerts:)` now carries
  the flag and iOS sends it; macOS just needs to pass it at the call site.
- iOS: no Notifications section in the account/profile UI (web shipped the
  per-user pref toggles in phase 10). Nothing on-device consumes them yet —
  iOS has no push notifications — so this closes with the APNs work.
- iOS: no Artifacts UI — no nested sidebar rows, artifact side panel, or
  pin-as-artifact action; the `artifact.*` WS events are safely ignored. Now
  the per-channel model (phase 13); server + web + macOS shipped together
  2026-07-23.
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
- iOS: typing indicator says "is typing…" even for agents; web + macOS show
  "is thinking…" for an agent at work (History 2026-07-22). The string lives in
  `ComposerView.swift`; the shared `AppState.agentIds` set is already populated
  on iOS (it reuses the macOS core) — it's a view-only switch.
- iOS: no member-profile popup at all — tapping another user's avatar does
  nothing (web + macOS open a profile card; macOS also shows an agent's
  "Sponsored by" row). Needs a new `MemberProfileSheet` on iOS plus avatar taps
  wired through `MessageListView`. `UserDTO.sponsorId` (shared) already carries
  the data.
- iOS: no per-channel scroll-position memory across channel switches (web +
  macOS added a 5-minute-expiry memory 2026-07-22). The shared
  `MessageScrollMemory` store is available to iOS; only the SwiftUI wiring in
  iOS `MessageListView` is missing.

### Deliberate divergences (ruled)
- Copy message text: explicit "Copy" item in the message menu on iOS + macOS
  (their custom Text rows aren't natively selectable); web omits it because
  browser text selection + Cmd/Ctrl-C already copies message text.
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
- Responsive/mobile layout (drawer nav, viewport-capped media and modals):
  web only, and inherently so — the native clients lay themselves out per
  platform, and the iOS app is the native phone experience. Not a gap.

## History

Phases 1-11 are archived in `CHANGES_ARCHIVE_PHASE1-11.log` (frozen
2026-07-22). Entries below start after phase 11.

### 2026-07-23 — Web notification banners are now clickable
- Clicking a browser (OS) notification banner from the web client now focuses
  the tab and jumps straight to the triggering message — selecting the right
  workspace/channel, opening the thread for a reply, flashing the message, and
  marking the notification read — the same navigation the in-app Activity list
  already does. Previously the banner had no `onclick`, so clicking it did
  nothing beyond the browser default. `[web]`

### 2026-07-23 — Artifacts: agent-created ones auto-open for the requester
- When an agent creates an artifact through the Flow MCP, it now **opens
  automatically** in the side panel for whoever is viewing that channel — the
  person who asked the agent to make it — instead of only appearing in the
  sidebar. Gated so it never yanks focus unexpectedly: only on the live
  `artifact.created` event (not `updated`), only when the artifact is
  agent-generated (`ownsFile` — a human "Pin as artifact" does not auto-open),
  and only for a client whose active channel is the artifact's channel. In an
  agent DM that targets exactly the one human; in a shared channel it pops for
  everyone currently viewing (there is no per-requester signal server-side).
  `[server]` `[web]` `[macos]`
- `ArtifactDTO` now carries `ownsFile` so clients can tell an agent-generated
  artifact from a human pin. macOS `artifact.*` events now distinguish
  created/updated/deleted (was created==updated). `[server]` `[web]` `[macos]`

### 2026-07-23 — Phase 13: side-panel, per-channel artifacts
- **Artifacts are now per-channel shared objects, not personal bookmarks.**
  Everyone in a channel sees the same artifacts (privacy = use a private
  channel); they nest under their channel in the sidebar and open in a
  right-hand **side panel** beside the conversation. "Save as artifact" is now
  **"Pin as artifact."** `[server]` `[web]` `[macos]`
- **The side panel is a tabbed container**: a Thread tab (when a thread is open)
  plus a tab for each of the channel's artifacts, switchable at the top —
  threads and artifacts coexist. The panel ✕ closes it; the Thread tab has its
  own ✕. In the sidebar the selected artifact reads as bold text (no second
  highlight pill under the active channel). `[web]` `[macos]`
- **Backing files are mutable**: an artifact re-points at a freshly uploaded
  file, so agents can *update* an artifact's content in place. Files stay
  immutable blobs. `[server]`
- **Data model** (`0019_artifacts_channel.sql`): the `artifacts` table is
  recreated channel-scoped (`channel_id`, `owns_file`, `created_by`,
  `updated_at`); pins are idempotent per `(channel, file)`. Existing per-user
  bookmarks are dropped — no channel to map them to (operator decision). Events
  ride a per-channel subject; the gateway's `visible()` filter keeps
  private-channel artifacts private for free. `[server]`
- **Delete removes the artifact's own file** when it owns it (agent-generated),
  guarded so a file still attached to a message or pinned elsewhere is kept.
  Reverses the phase-9 "never touch the file" ruling for owned files only.
  `[server]`
- **Flow MCP**: `create_artifact` now pins into the current channel (drops the
  one-recipient model); new **`update_artifact`** renames and/or replaces
  content in place. `[bridge]`
- Supersedes the phase-9 per-user artifact rulings (see decision_log
  2026-07-23). QA: pin/side-panel/nested-sidebar + agent create→update→delete.
  `[qa]`

### 2026-07-23 — Phase 14: signed + notarized macOS distribution
- **New `apps/macos/tools/dist.sh` produces a signed, notarized `dist/Flow.dmg`**
  in one non-interactive command — release build (reuses `make-app.sh` so bundle
  assembly never drifts), Developer ID signature under the hardened runtime with
  a secure timestamp, blocking notarization, stapled ticket, DMG, and a final
  `spctl`/`stapler` gate check. Opens on a clean Mac with no Gatekeeper warning.
  `[macos]`
- Env-var contract `FLOW_SIGN_IDENTITY` + `FLOW_NOTARY_PROFILE` (docs/specs/
  phase14.md §2); the script holds no secrets and **aborts** if either is unset
  or the identity is absent — never falls back to ad-hoc (an ad-hoc build can't
  be notarized). `[macos]`
- Empty `tools/Flow.entitlements` (Keychain + UserNotifications need none under
  the hardened runtime; grow only as notarization dictates). `[macos]`
- `.github/workflows/dist-macos.yml` runs the same script in CI behind the same
  env contract, adding only keychain plumbing (import cert to a temp keychain,
  create the notary profile in-job), and uploads the DMG artifact. `[macos]`
- Packaging only — no client behavior changes, so no Parity line. Distribution
  (a download link) and auto-update are deliberate follow-ups, not this phase.

### 2026-07-23 — "What's new" from the Build label
- **Clicking the `Build …` label at the foot of the workspace menu opens a
  "What's new" lightbox** that renders `FEATURES.md`. `[web]` `[macos]`
- Web serves `FEATURES.md` as a static asset (copied into `web/public` by the
  predev/prebuild step alongside the agent skill) and renders it with the shared
  block-markdown renderer (`renderBlocks`), folding soft-wrapped source lines
  first. macOS bundles `FEATURES.md` into the `.app` (`make-app.sh` →
  `Bundle.main`, with a `#filePath` repo fallback for dev runs) and renders it
  in a sheet via a small headings/bullets renderer (the message `MarkdownBlocks`
  path has no heading/list support). `[web]` `[macos]`

### 2026-07-23 — Fix: agent "thinking…" indicator scoped to its thread
- **When an agent answers a thread reply, its "thinking…" typing indicator now
  shows in that thread's composer, not above the main channel composer.** The
  bridge's `ProgressReporter` already knew the `threadRootId` (it posts the
  status message into the thread), but the typing frames dropped it, so clients
  keyed the indicator to the channel composer (`typingKey(channelId)`) instead
  of the thread (`typingKey(channelId, threadRootId)`). `FlowSocket.sendTyping`
  now forwards the optional `threadRootId`; server + web already supported it.
  Regression test in `test/progress.test.ts`. `[bridge]`

### 2026-07-22 — Build tag in the workspace menu
- **The deployed build's short commit SHA now shows at the foot of the
  workspace menu** (e.g. `Build a1b2c3d`), so you can tell which build is live.
  `[web]` `[macos]`
- Web injects it at Vite build time (`define` → `__BUILD__`). Locally it's
  `git rev-parse --short HEAD`; on Railway (whose Railpack build has no `.git`)
  it falls back to the `RAILWAY_GIT_COMMIT_SHA` build var, so prod shows the
  real commit rather than `dev`. macOS `make-app.sh` writes `FlowBuild` into the
  bundle Info.plist, read via `BuildInfo`. Both honor a `BUILD_SHA` env override
  and fall back to `dev` outside a checkout. `[web]` `[macos]`

### 2026-07-22 — Optimistic send: a failed message stays put with Retry
- **A send that fails no longer discards the message.** Both clients already
  inserted the optimistic row before the POST; the change is the failure path.
  On error the row now stays in the stream flagged `failed` — dimming clears
  and a "Failed to send · Retry / Discard" affordance appears — instead of
  vanishing (web) or spinning as pending forever (macOS). `[web]` `[macos]`
- Retry re-POSTs with the **original `clientMsgId`**, which the server is
  idempotent on `(channelId, clientMsgId)`, so a retry is safe even if the
  first POST actually landed. Retry flips the row back to pending and re-bumps
  the thread rollup; a failed reply un-bumps the root's reply count so it
  reflects only confirmed replies (re-bumped on a successful retry). `[web]`
  `[macos]`
- Web: `markSendFailed` (new) replaces `removePendingMessage` on the error
  path; `useSendMessage` keeps the outgoing vars keyed by `clientMsgId` so
  Retry replays the identical POST (mentions included — not recoverable from
  the stored wire body). `MessageRow` renders the affordance and suppresses the
  hover menu on failed rows. `[web]`
- macOS: new `failed` column (migration `v9`) + `Message.failed`; `SyncEngine`
  gains `deliver`/`retrySend`/`discardFailed` and an `unbumpThreadRollup`;
  retry recovers `<@id>` mentions from the wire body. `MessageRow` shows the
  footer + a Retry/Discard context menu; added an `MC.danger` token. `[macos]`
- Verified: web `vitest` (24 pass, incl. new `markSendFailed` cache tests) +
  `tsc --noEmit`; macOS `swift build` clean. `[qa]`

### 2026-07-22 — macOS: message hover menu matches the web version
- **The macOS message hover pill now reads identically to the web one.** Added
  the three one-tap quick reactions (👍 👀 🙌) and a hairline divider ahead of
  the existing actions, plus a 📋 Copy-text button, and swapped the monochrome
  SF Symbols for the same emoji glyphs the web client uses (🙂 add-reaction,
  💬 reply-in-thread, ✏️ edit, 🗑 delete). Buttons gain the web's
  `hover:bg-daypill` rounded highlight; save-as-artifact keeps the SF Symbol
  open-external mark (web draws it as an inline SVG). Same per-button gating
  as web (thread/copy/artifact/edit/delete conditions unchanged). `[macos]`

### 2026-07-22 — Phase 12: #Activity feed replaces the notifications bell
- **New: an always-present "Activity" entry at the top of the channel list,
  and the notifications bell is gone.** Activity surfaces exactly the alerted
  messages the bell's dropdown showed — mentions, DMs, thread replies, and
  notify-all activity — but as a full, in-place feed instead of a transient
  popover. `[web]` `[macos]` `[ios]`
- **Activity is a virtual, per-user "channel", not a real one** — no DB row, no
  migration, no server change. It renders the same `/v1/me/notifications` feed
  the bell used (already deduped one-row-per-message, precedence-ordered, and
  carrying the decrypted message preview + read state). Each user sees only
  their own activity, which a shared channel couldn't do. Server + its
  `notifications.test.ts` are untouched. `[web]` `[macos]` `[ios]`
- Opening Activity marks everything up to the newest row read (channel
  semantics) and clears the unread badge, which moved off the bell onto the
  Activity row. `[web]` `[macos]`
- **Jump-to-message (beyond bell parity): tapping a row scrolls to the exact
  triggering message and flashes it**, paging older history in first when the
  message sits beyond the last loaded page (the old bell only opened the
  channel). Shared `focusMessageId` selection state drives the channel's main
  list (with paging) and the thread view (loaded whole); a brief tinted
  highlight fades out. All three clients; on iOS it covers top-level messages
  (thread replies land in the channel — see Parity). `[web]` `[macos]` `[ios]`
- Web: removed `NotificationsBell` and its three top-bar mounts; added
  `ActivityView` + a pinned `ActivityRow` sidebar entry (sentinel
  `ACTIVITY_VIEW_ID`, same virtual-row pattern as the admin panel). `[web]`
- macOS: removed the toolbar bell + `NotificationsPopover`; added
  `ActivityFeedView` + a pinned sidebar `activityRow`, routed via a new
  `AppState.showActivity` flag (covers the content pane like an artifact
  panel). `[macos]`
- iOS: **net-new** (iOS never had a bell). The shared model/engine/socket
  already carried notifications; added only the UI — `ActivityFeedView`, an
  always-present list row, and a sentinel nav route on the existing
  `NavigationStack`. This closes the iOS notifications-view gap. `[ios]`
- Verified: `pnpm build` (web, tsc + vite), `swift build` (macOS), and an
  iphonesimulator `xcodebuild` (iOS) all pass; web Activity + jump-to-message
  confirmed live against the local dev server. `[qa]`

### 2026-07-22 — macOS: profile-on-avatar sponsor, scroll memory, agent "thinking"
- Closes the three macOS parity gaps opened by the web nits earlier today.
  iOS follows in a later pass (the shared data model below is already in place
  for it). `[macos]`
- **Tapping a message sender's avatar opens their profile card** (channels and
  threads), via a new `onOpenProfile` callback threaded through `MessageListView`
  → `MessageRow`. macOS already had the card; it was only reachable from the
  header before. `[macos]`
- **Agent profile cards show a "Sponsored by" row** with the sponsor's avatar
  and name. This needed a data path: `UserDTO` gained a `sponsorId` field
  (`toUserDTO` fills it from `sponsorUserId` for agents), the Swift `User` model
  + a `user.sponsorId` DB migration (v8) carry it, and the card resolves the
  sponsor with a second `fetchUser`. `[server]` `[macos]`
- **Agents "think" in the typing indicator** — `TypingIndicatorView` now says
  "<name> is thinking…" for an agent, driven by a new shared
  `AppState.agentIds` set (derived alongside the avatar map in `SyncEngine`).
  `[macos]`
- **Per-channel scroll-position memory** — a shared, process-lifetime
  `MessageScrollMemory` store remembers the top-visible message id per channel
  (5-minute expiry); `MessageListView` re-anchors there on return via
  `.scrollPosition`, else lands at the bottom. Threads keep their always-newest
  behavior. `[macos]`
- Verified with `swift build` (clean). The `UserDTO.sponsorId` addition is
  backward-compatible and typechecks across server + web. `[macos]` `[server]`

### 2026-07-22 — Web: profile-on-avatar, scroll memory, agent "thinking" label
- **Clicking a message sender's avatar opens their profile card.** The card
  (name, email, avatar, local time) already existed but was only reachable from
  the DM/channel header; message-row avatars are now buttons that open it, in
  channels and threads alike. `[web]`
- **Agent profile cards show their human sponsor.** For an agent, the card now
  renders a "Sponsored by <name>" row with the sponsor's avatar, resolved from
  the workspace roster's `sponsorId` (no server change — the id was already on
  the member DTO). `[web]`
- **Per-channel scroll position is remembered across channel switches.** Scroll
  back in #A, hop to #B and return, and you land where you left off instead of
  snapped to the bottom. Memory is module-level (survives the per-channel
  remount) and expires after 5 minutes — return later and you snap to the
  bottom, the freshest place. A new message only pulls you down while you're
  already pinned at the bottom. `[web]`
- **An agent at work now reads "is thinking…" not "is typing…"** in the typing
  indicator, matching how the bridge describes itself. Humans still "type". `[web]`

### 2026-07-22 — agent-bridge: startup version check against npm
- **New: the bridge checks npm on startup and warns when it's stale.** Nothing
  ever told a running agent it was behind — operators only found out by reading
  the package manually. On boot the bridge now reads its own `package.json`
  version, fetches `flow-agent-bridge/latest` from the npm registry, and
  semver-compares. `[bridge]`
- If it's behind, it logs a warning and posts one notice ("I'm running v0.4.0,
  but v0.5.1 is available on npm…") to the first non-DM channel it's a member
  of. Best-effort throughout: the check runs non-blocking after the socket
  connects, and every failure path (offline, registry down, unreadable
  package.json, no channel) is swallowed — it never delays or crashes startup.
  `[bridge]`
- Semver core comparison (`isOutdated`) ignores prerelease/build metadata and a
  leading `v`, and fails safe (returns not-outdated) on unparseable input.
  Covered by `test/version.test.ts`. `[bridge]`

### 2026-07-22 — iOS: browse, join and create channels
- **Fixed: iOS had no way to reach a channel you weren't already in.** The
  channel list queried `isMember == true` and offered no browse, join or
  create affordance, so a phone-only user could never discover `#app-ideas`
  or start a new channel — web and macOS have had both since phase 2. `[ios]`
- New "Browse" section lists public channels you're not in, each with a Join
  that enrolls you and pushes straight into the channel. Same filter macOS
  uses (`!isMember && !isPrivate && !isDM`); the server already excludes
  archived channels and invisible private ones, so no extra guard is needed.
  `[ios]`
- New-channel button in the nav bar opens a form (name, optional topic,
  private toggle) and drops you into the created channel. Name normalization
  is character-for-character the macOS rule (lowercased, spaces to dashes),
  with a live "Will be created as #…" hint. `[ios]`
- No new sync work: `refreshChannels` already cached every channel the server
  lets you see, non-member rows included — the list was simply filtering them
  out. `ChannelListView` gained an `onOpenChannel` callback so it can push onto
  the `NavigationStack` path that `MainView` owns. `[ios]`
- Verified in the simulator against the local dev server: Browse renders
  `#app-ideas` with Join, and joining moves it live into Channels (with its
  unread badge) while the emptied Browse section disappears. The Join and
  Create taps themselves were not driven — no UI automation tool was used —
  but both call the same `SyncEngine` methods macOS already ships. `[ios]` `[qa]`

### 2026-07-22 — iOS: account avatar button (profile + status picker)
- The channel list's plain `person.crop.circle` toolbar menu is now a real
  avatar button — the user's avatar with their status emoji badged on it —
  and the same button rides the channel screen's nav bar, since a phone never
  shows the sidebar footer the web/macOS affordance lives in. `[ios]`
- Tapping it opens an account sheet: profile header (avatar, name +
  connection dot, email, current status), the eight canned statuses with
  "Pauses notifications" on the DND-family rows and a checkmark on the active
  one, Clear status, "My Profile…" and Sign Out — the web avatar menu +
  status picker, merged into one sheet for touch. `[ios]`
- **My Profile** pushes an edit form: avatar change via the photo library
  (HEIC re-encoded to JPEG, same rule the composer uses), display name,
  timezone, email; saves through `PATCH /v1/me`. `[ios]`
- iOS and macOS status picks now send `statusSuppressAlerts` alongside the
  emoji + text, so a DND-family status pauses alerts and a plain one resumes
  them. `MC.statusOptions` grew the `suppresses` flag (matching web's
  `STATUS_OPTIONS`), `PatchMeBody` the field, and `SyncEngine.setStatus` a
  `suppressAlerts:` parameter. `[ios]` `[macos]`
- **Fixed: macOS could strand notifications paused.** The server only writes
  the column when the field is present, and the macOS status picker never sent
  it — so picking "Available" after "Do not disturb" left alerts suppressed
  behind an innocent-looking status. Confirmed against the dev server: a
  flagless `PATCH /v1/me` returned `statusText: "Available"` with
  `statusSuppressAlerts: true`. Every macOS pick (and Clear status) now sends
  the flag explicitly, as web already did. `[macos]`
- `uploadAvatar` now republishes the avatar-path map, so a new avatar repaints
  message rows immediately instead of waiting for the next member refresh
  (shared engine — fixes the same lag on macOS). `[ios]` `[macos]`
- Verified by hand in the simulator against the local dev server (status pick
  round-trips to `PATCH /v1/me`); no headless QA hook ships with this — a
  `FLOW_DEBUG_SET_STATUS` modifier hung off the toolbar item never fired
  (toolbar-hosted views get neither `.task` nor `.onAppear` reliably) and was
  dropped rather than shipped unverified. `[ios]` `[qa]`

### 2026-07-22 — Web: keep the viewport pinned when a link preview lands
- Fixed: a message list sitting at the bottom stopped following its own
  content, so a late-arriving unfurl card (and its image) rendered below the
  fold instead of scrolling into view. `[web]`
- Cause was a race in the stay-pinned logic, not in unfurling. A scroll event
  is delivered a frame after the scroll that produced it, so the pinning
  `scrollTop = scrollHeight` came back as a *scroll* whose measured
  distance-from-bottom already included the card image that had loaded in the
  meantime (measured: a 296px gap). `onScroll` read that as "the user scrolled
  away" and latched `pinned = false`, which then vetoed every later
  re-pin. Distance now only ever pins us back *on*; leaving the bottom is
  signalled by `scrollTop` actually moving up, which content growth never
  does. `[web]`
- Verified in a browser against the QA workspace: channel load settled 592px
  short of the bottom before, 0px after; a card arriving on a pinned list now
  lands fully visible; scrolled-up readers are still not yanked down by
  growth, and scrolling back to the bottom re-pins. `[qa]`

### 2026-07-22 — Native: link preview cards (macOS + iOS)
- macOS and iOS render `MessageDTO.unfurls`, closing the phase 11 parity gap.
  Accent rail, favicon + site name, title, description, author/date and image,
  in the same slot as the web card (below attachments, above reactions).
  Tapping the card opens the page; the ✕ removes it (author only — hover on
  macOS, always shown on iOS since touch has no hover). `[macos] [ios]`
- One shared `UnfurlCardView` under `Support/`, like `MarkdownTableView`, so
  the two platforms can't drift. `Unfurl` decodes leniently (every field but
  the URL optional) and is cached with the message as JSON in a new `unfurls`
  column — local DB migration v7; rows cached before it simply have no cards
  until refetched. `[macos] [ios]`
- **Favicons are now proxied too, fixing a spec violation shipped earlier
  today.** The server was emitting the *remote* favicon URL and the web card
  hotlinked it, contrary to §6 ("never hotlink") and §8 (which shows
  `favicon_url` as an internal URL) — every card render leaked the viewer's IP
  to that third-party origin. Favicons now go through the same validate +
  re-encode + store pipeline, and the web card loads them via `AuthImg`.
  Trade-off: `.ico` favicons are dropped (sharp can't decode ICO), so those
  cards show the site name without a mark. `[server] [web]`
