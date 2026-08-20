# Changelog

**Entries no longer live in this file.** As of 2026-08-06, every feature or fix
PR adds its own file to `changelog/` (`YYYY-MM-DD-slug.md` — format in
`changelog/README.md`), so concurrent PRs cannot conflict. FEATURES.md is
generated from those files by `scripts/build-features.mjs`.

This file keeps two things:
- the **Parity** ledger below — a change that lands on one client but not the
  others MUST still add a line here (and remove it when closed);
- the index of frozen history archives at the bottom.

## Parity

### Gaps to close
- Clearing a channel's Activity unreads on open without waiting for the server
  (#227) landed on macOS and iOS only. Web still leaves the badge up until the
  `notification.read` round trip returns; the fix is an optimistic cache write
  in `useMarkRead`/`ChannelView`, and web's `markRead` is gated behind the
  message query in the same way the native one was.
- "Share to Flow" from the system share sheet is iOS-only (#214, extended to
  videos and documents in #219). macOS supports
  share extensions too and the extension's logic is platform-agnostic
  (`APIClient` + `ImagePrep` + a channel picker), so this is a target and an
  entitlement rather than new work. Web has no OS share sheet to hook.
- Auto-linked channel topics (#194) land on web and macOS only. iOS now shows
  the topic in its header (#202) but as plain text — the link logic lives in
  the shared `Support/MentionRendering.swift`, which the iOS target already
  compiles, so this is a small port rather than new work.
- A transcript with no history cached yet renders as bare background on web and
  macOS while the first page is in flight (#191) — on a slow link that reads as
  a lost conversation. iOS now shows a loading state instead; the shared
  `AppState.loadingHistory` the engine publishes is client-agnostic, so both are
  a pure client port.
- Custom emoji (#175) are web-only: macOS and iOS render a custom reaction as
  the literal text `:shortcode:` rather than the image. The reaction itself is
  correct everywhere (count, who reacted, notifications) — only the glyph is
  missing. Each client needs to fetch `GET /v1/workspaces/:id/emoji` and swap in
  the image. Custom emoji inline in *message text* is unbuilt on every client.
- Scroll-position memory exists on no client: leaving a channel mid-history and
  coming straight back always re-opens at the newest message. Tried on iOS
  (#159) and removed — tracking the on-screen row needs per-row geometry, which
  makes every layout pass touch every row and freezes the app on a channel
  switch. Needs a `UIViewRepresentable` over `UICollectionView` (or the web
  equivalent) to do safely.
- Reopening the last-viewed channel on launch is iOS-only (#242). The storage
  and the validation live in the shared `WindowState`, so macOS is one call to
  `restorableLastChannel` away — it deliberately still opens on the workspace
  it remembers and nothing more. Web has no launch-restore either.
- The two native clients decide "follow the newest message?" differently since
  #159: iOS keys off a deliberate 200pt finger-drag, macOS classifies content
  growth vs user scroll (`classify` in its `MessageListView`). Same intent,
  different mechanism — worth converging on one if either misbehaves again.
- iOS: no text zoom (#105). macOS scales every font from a `\.textZoom`
  environment value driven by ⌘+/⌘−/⌘0. iOS wants Dynamic Type instead — a
  system-wide setting with no keyboard shortcut — so it's a different mechanism,
  not a port. The shared `Support/` layer already carries the scale.
- Sign in with Apple is iOS-only (#124): web + macOS still offer only
  Google/password. `/v1/auth/apple` is client-agnostic; macOS can use the same
  native ASAuthorization flow, web needs Apple's JS flow (Services ID +
  redirect setup — more than a pure port).
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
- iOS artifacts, what's still missing after #157 (2026-07-30). Viewing is done —
  header Docs button, count badge, dropdown, full-screen viewer, co-browsing
  mini-browser, and auto-open of agent-created ones. What's left:
  - **No pin-as-artifact.** Web + macOS can pin a message's file; iOS can't.
    Needs a message long-press action and a naming flow. Pure client port —
    `createArtifact` is already in the shared `SyncEngine`.
  - Deliberate: the badge counts **all** artifacts in the channel, not unseen
    ones — no client tracks per-user last-seen for artifacts and the server
    doesn't model it, so an unseen count on iOS alone would disagree with macOS
    about the same channel.
- macOS co-browse re-points a link artifact just by opening it: `WKWebView`
  canonicalizes `https://host` to `https://host/` on commit, and
  `CoBrowserWebView` compares literally, so the didCommit handler reads its own
  programmatic load as a user navigation and PATCHes. Every viewer's page
  changes (cosmetically) because someone looked. iOS compares scheme/host/port/
  path/query/fragment instead (#157); macOS wants the same fix — web is
  unaffected (the iframe can't see cross-origin navigation at all).
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
  server. iOS diverged 2026-08-12 (App Review Guideline 4 rejection): it now
  registers in-app (email-first Register tab) and runs Google sign-in in an
  in-app web-auth sheet instead of Safari. Deliberate for macOS — it ships
  outside the App Store, and the browser handoff is normal there. iOS still
  has no in-app password reset (the emailed flows land on the web, which is
  fine — App Review only flagged browser-based sign-in/registration).
- iOS: no inline video preview/playback card — video attachments render as a
  name+size chip that opens in QuickLook (which does play them); web/macOS
  render inline players with an expand affordance.
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
  web + macOS sidebars carry — the virtual agent rows under Direct Messages
  (start a DM with a workspace agent that has no existing 1:1), the workspace
  color picker, and the Manage Users / Manage Apps workspace-menu items. Channel
  context actions (mute/leave/archive, invite to channel) are also not yet wired
  on iOS. The drawer's structure makes these straightforward ports; none are
  backed on-device yet. (The "new DM" composer was closed 2026-08-16, #257 —
  sidebar "+" and a profile-card Message button. "Invite People" was closed
  2026-08-18, #283 — which also brought #85's join-link management to iOS.)
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

- iOS: auto-scroll has the follow latch fixed on macOS 2026-07-28 — its
  jump-pill at-bottom check unpins on content growth, so a tall arriving
  message can silently stop the follow. Needs the same pinned-follow port
  (web and macOS now share the model; iOS's `MessageListView` is a separate
  copy with a settle-scroll timer to reconcile).
- iOS: no inline video player at all — video attachments render as a file chip,
  so the #96 aspect-ratio fix (macOS 2026-07-28) has nothing to land on there.
  Web was already correct: its `<video>` carries only max-width/max-height and
  CSS replaced-element sizing keeps the intrinsic ratio. Closes when iOS gets an
  inline player (AVKit, same sizing rule as macOS).
- iOS: no channel activity spinner (#137) — web and macOS spin a channel's
  sidebar row while an agent works there. Server API and the `channel.indicator`
  event are client-agnostic and `ChannelDTO.indicator` carries the initial
  state, so this is a pure client port.

### Deliberate divergences (ruled)
- Per-channel scroll-position memory (10-min TTL) is macOS-only, by operator
  ruling: a desktop sidebar switch should return you to your back-scroll spot,
  while a phone's full-screen channel change makes bottom-on-return the
  expected behavior, so iOS deliberately skips it. Web has no equivalent
  either; if it ever wants one, the model is `MessageScrollMemory` + the
  top-visible-row preference in the macOS `MessageListView`.
- The transcript's re-stick-on-shrink rule (#280) is iOS-only. macOS keeps
  `.defaultScrollAnchor(.bottom)` in its all-roles form, so the framework
  re-anchors on content size changes for free; iOS dropped the `.sizeChanges`
  role in #159 because that free behaviour yanked short back-pulls to the
  bottom, and `TranscriptFollow` is what replaces it. Web sets `scrollTop =
  scrollHeight` against real DOM heights and never estimates, so it cannot
  overshoot either. Not a gap.
- The hand cursor over hyperlinks (#81, widened to table cells and the channel
  topic in #276) is macOS-only: web gets it from the browser's own `cursor:
  pointer`, and iOS has no pointer. Not a gap.
- The version label shows the build number on iOS (`Version 2.0 (21)`) but not
  on macOS: every TestFlight build of a release shares one marketing version, so
  the number is what identifies which build a tester is running. macOS versions
  are unique per release and already carry a commit SHA.
- Multiple independent windows (⌘N, each with its own workspace/channel/thread
  selection) are macOS-only: the browser already gives web this via tabs, and
  the iPhone is a single-screen app. Inherent to the platforms, not a gap.
- Text zoom (#105) is not built into the web client: the browser's own ⌘+/⌘−
  already zooms it, and an in-app control would fight it. Not a gap.
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
  Both clients share the browser's session on purpose (the iOS sheet sets
  `prefersEphemeralWebBrowserSession = false`): #279 fixed the silent sign-in
  in the handoff page itself, so the shared cookies now only mean Google's
  account chooser opens already listing the device's accounts. Not a gap.
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
- A `.heic` uploaded from Chrome or Firefox still lands with no thumbnail and
  no dimensions, where macOS, iOS and Safari convert it to JPEG first (#243).
  Neither end can fix it: those browsers can't decode HEIC, and the server's
  prebuilt libvips reads the HEIF container but can't decode HEVC pixels.
- Responsive/mobile layout (drawer nav, viewport-capped media and modals):
  web only, and inherently so — the native clients lay themselves out per
  platform, and the iOS app is the native phone experience. Not a gap.

## History

Archived by phase — this file keeps only the Parity ledger. Work after
2026-08-06 has one file per change in `changelog/`.

| Archive | Span | Contents |
|---|---|---|
| `CHANGES_ARCHIVE_PHASE1-11.log` | through 2026-07-22 | phases 1-11, up to and including URL unfurling |
| `CHANGES_ARCHIVE_PHASE12-16.log` | 2026-07-22 → 2026-07-26 | phases 12-16: #Activity feed, artifacts, signed macOS distribution, agent invites, Sign in with Google |
| `CHANGES_ARCHIVE_PHASE17.log` | 2026-07-26 → 2026-08-06 | phase 17 (re-domain to freeflow.im) + join links, thread parking, sub-channels, agent interrupts, pins, custom emoji, per-PR CI |
| `changelog/` directory | 2026-08-06 → | one file per change, ongoing |

