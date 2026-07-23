# Changelog

Convention: every feature/fix entry tags the platforms it landed on —
`[server]` `[web]` `[macos]` `[ios]` `[bridge]` `[qa]`. A change that lands on one client
but not the others MUST add a line to **Parity** below (and remove it when
closed). Updated with every milestone commit (PM) and interactive-session fix
(coordinator).

## Parity

### Gaps to close
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
