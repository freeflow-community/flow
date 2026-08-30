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
- **Scheduled messages** (#419/#420) ship with web-only UI; macOS and iOS have
  neither the Scheduled panel nor the SCHEDULED badge. The server half is
  client-agnostic and complete — `MessageDTO.scheduled` rides every message
  payload and WS event, and the whole feature is one REST surface
  (`/v1/scheduled-messages`) — so closing the gap is two client jobs, and they
  are independent: the badge alone (read `scheduled` in the message row, and
  break message grouping on it the way web does) is a small change worth doing
  first, since without it a native client renders an automatic message as if
  the author had just typed it. The panel is the larger piece.
- **Auto-opening the thread that holds a channel's oldest unread** (#327) landed
  on web only. The signal is server-side and already sent to every client
  (`ChannelDTO.oldestUnreadThreadReply`), so closing the gap is client work:
  macOS/iOS cache channels locally, so each needs the field persisted (a column
  + migration) and kept fresh the way `unreadThreadRootIds` already is, then a
  sidebar tap that calls the existing jump primitive
  (`WindowState.openNotification(workspaceId:channelId:messageId:threadRootId:)`
  on macOS) instead of a plain channel select.
- **Apps section in the left nav** (#394) landed on web and macOS only; iOS was
  explicitly out of scope for the issue. The server query
  (`GET /v1/workspaces/:id/app-artifacts`) is client-agnostic and complete, so
  closing the gap is an iOS sidebar section over it plus the join-then-open tap
  — the same shape as `AppsSection` on macOS.
- Built-in **help docs** (#383) ship on web and macOS (#384); **iOS has no help
  viewer**. The content and the API are client-agnostic (`docs/help/*.md` behind
  `GET /v1/help/topics` and `/v1/help/pages/:slug`), so closing the gap is one
  more viewer — the macOS one is ~200 lines over `MarkdownBlocks`, which iOS
  already compiles. Web also hides help below the `md` breakpoint, so a
  phone-width browser window has no way in.
- Mini apps in a **frame** don't work in Safari, on any client. The #371 spike
  measured it: WebKit neither stores the guard's `SameSite=None` cookie in a
  frame nor sends one already established first-party, and the guard's 302 to
  the clean url drops the token — so re-minting per load can't help either. Web
  routes Safari to a new tab, which works. Closing the gap needs a guard-side
  change (bridge): keep the session in a url the guard controls, or have the 401
  page call `requestStorageAccess()`.
  **The native clients are not affected** — #372 (macOS panel `WKWebView`) and
  #373 (iOS in-app `WKWebView` and mobile Safari) each re-ran the spike and both
  pass: the app loads as a *top-level* document, so the guard's cookie is
  first-party and ITP has nothing to block (document, subresource and XHR all
  authenticated). The limitation is iframe-specific, not WebKit-wide.
- **Chat polish** (#387) landed on web and macOS only; iOS was out of scope for
  the issue. The white chat background is an `MC.chat` token macOS uses and iOS
  does not, and the message-body rhythm (1.5 line-height, block/list spacing,
  `list-disc`-sized bullets) plus the inline-code chip live in the macOS
  `MessageListView` and behind `MentionRendering.attributed(codeChips:)`, which
  defaults off. Closing the gap is adopting both in the iOS message list.
- **Invite to workspace** on the profile popup (#358) landed on web and macOS
  only; iOS was explicitly out of scope for the batch. The server side (#357
  agents, #359 people) is client-agnostic and complete, so closing this is a
  `MemberProfileSheet` equivalent plus Accept/Decline cards on the iOS
  workspace switcher — the same two views the other clients grew. Until then an
  iOS-only user can be invited but cannot accept in the app.
- The channel Files list (#347/#348) shows a video's first frame on web only.
  The browser can paint one from the presigned stream URL for free; macOS and
  iOS render a play badge on a tinted block instead, because AVFoundation would
  have to decode a frame to produce the same thing. The duration badge itself
  is on all three. Closing this means either a server-side video thumbnail
  (needs a decoder the server doesn't have) or a one-frame AVAssetImageGenerator
  pass on the native clients.
- Jump-to-message does not land in a transcript deep enough to need paging
  (#332): with the target more than one 100-row window back, `ChannelScreen`
  widens the window and the centring scroll still leaves the row off screen.
  Shallower jumps, and jumps inside a thread, land on every client. macOS pages
  differently (no window) and is unaffected; web is unaffected.
- Per-user notification alert prefs have a UI on web only — macOS and iOS
  render every kind and honour the server's `suppressAlert`, but offer no way
  to change the toggles behind it. Noted with the `channelInvite` pref (#303),
  which inherits the same gap as `dm`/`mention`/`reaction` rather than adding a
  new one. `PATCH /v1/me` is the whole API; each native client needs a settings
  pane.
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
  web + macOS sidebars carry — the workspace color picker and the Manage Users /
  Manage Apps workspace-menu items. Channel context actions
  (mute/leave/archive) are also not yet wired on iOS. The drawer's structure
  makes these straightforward ports; none are backed on-device yet. (The "new
  DM" composer was closed 2026-08-16, #257 — sidebar "+" and a profile-card
  Message button. "Invite People" was closed 2026-08-18, #283 — which also
  brought #85's join-link management to iOS. "Invite to channel" was closed
  2026-08-21 — ⋯ menu item + drawer long-press. Virtual agent rows were closed
  2026-08-25, #361 — the Agents section carries them on all three clients.)
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
- The **workspace avatar in the sidebar header** was web-only and is now gone
  (#422): web drew it beside the workspace name as well as in the left rail,
  while macOS and iOS only ever drew it in the rail. Removing it aligns web
  with the native clients — nothing to port. Not a gap to close.
- The **channel emoji** (#396) draws on web and macOS and not on iOS, which
  renders nothing in that slot today: it has no channel indicator either, so
  adding the emoji alone would build the slot for half its tenants. The server
  and the `channel.emoji` event are client-agnostic and the field already rides
  the channel payload, so iOS picks both up together whenever that slot is
  built. Not a gap to close on its own.
- **Channel visit history** with back/forward buttons (#386) is web + macOS
  only. iOS was out of scope on purpose: the phone navigates a push/pop stack
  that already has its own back affordance, so a second, differently-scoped
  history in the header would compete with it rather than complete it. The
  model (`NavHistory`) is 60 lines and would port, but only alongside a
  decision about what "back" means on a stack — not a gap to close blindly.
- The **hover ⋯ menu on sidebar rows** (#399) ships on web and macOS and not on
  iOS, for the same reason as the topic tooltip below: a touch client has no
  hover to reveal it on. iOS reaches channel options from the channel screen
  instead (`ChannelOptionsSheet`), so nothing is out of reach; its sidebar
  long-press stays the one-item Invite menu it is today. Not a gap to close.
- The **channel topic tooltip** (#392) ships on web and macOS and not on iOS —
  the issue scoped it that way, because a touch client has no hover to hang it
  on. iOS already shows the topic under the channel name in the header, so
  nothing is hidden there; a phone equivalent would be a different affordance
  (tap-and-hold), not this one. Not a gap to close.
- Mini apps open **inline on macOS and iOS, in a new tab on web** (#380). The
  native clients load the app top-level in their co-browser web view, where the
  guard's cookie is first-party; web's artifact pane is a cross-site iframe,
  which WebKit blocks (see the frame gap above), so it keeps the #371 new-tab
  hand-off. Not a gap to close on web until that guard-side change lands.
- Co-browsing is suppressed for `isApp` artifacts on macOS and iOS (#380) and
  has no meaning on web, which never framed an app. An app is opened, not
  co-browsed: each viewer mints their own token into their own guard session, so
  broadcasting one member's navigation — or the guard's 302 on every open —
  would re-point the shared artifact for the whole channel. `MiniApp` holds the
  rule for both native clients and its tests compile into both.
- Clamping the side panel to the space available, and making image and video
  attachment cards fit the transcript column (#354), are both macOS-only. Web
  has the same fixed-width panel and the same card caps, but flexbox squeezes
  where SwiftUI's `HStack` and fixed `frame`s clip, and below the `md`
  breakpoint web's panel becomes a full-screen overlay instead — so neither
  defect exists there. iOS pushes Files and threads full-screen and has no split
  to break. If macOS ever wants web's behaviour at
  its narrowest widths, that is a follow-up, not a gap this leaves open.
- Workspace avatars (#336) are *managed* from web and macOS only; iOS displays
  the mark but offers no upload or remove, as the issue specified. iOS has no
  workspace-settings surface at all today — the sidebar colour isn't editable
  there either — so this inherits that gap rather than adding a new one.
- Scrolling the active channel into view on non-click navigation (#319) is web
  + macOS only. iOS has no persistent channel list — its `SidebarDrawer` is
  dismissed the moment you pick a channel, so there is no stale scroll position
  to correct. If the drawer ever becomes persistent, the fix is the same
  `ScrollViewReader` + nil anchor the macOS `SidebarView` now uses.
- The floating pill header (#298) is iOS-only, by operator ruling. It answers a
  phone problem — a full-screen conversation with no sidebar beside it to carry
  the workspace colour. macOS and web both show the channel list next to the
  transcript and already read as one surface.
- Within iOS, the pill is on the channel screen only. The thread screen keeps
  the system bar: hiding it costs the interactive edge-swipe pop, which
  `ThreadNavTests` catches. Gap to close if the gesture can be kept.
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

