# Changelog

Convention: every feature/fix entry tags the platforms it landed on —
`[server]` `[web]` `[macos]` `[ios]` `[bridge]` `[qa]`. A change that lands on one client
but not the others MUST add a line to **Parity** below (and remove it when
closed). Updated with every milestone commit (PM) and interactive-session fix
(coordinator).

## Parity

### Gaps to close
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
- macOS/iOS: no **Invite your Agent** CTA (phase 15) — the web sidebar gained a
  button + dialog that mints a one-time invite code (`npx flow-agent-bridge
  <code>`) above the profile footer. Native clients can't yet generate a code,
  so onboarding an agent from a phone/desktop still means grabbing the code from
  the web app. Closes when each client ports the `POST
  /v1/workspaces/:id/agent-invites` call + the display dialog. No approval
  surface is needed any more (redemption is immediate).

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

- macOS + iOS: the channel header avatar stack is still decorative — web made it
  open a member-list popover (names, presence, status, tap-through to the user
  card) on 2026-07-25 (#70). macOS also still fills the stack with the workspace
  roster for standard channels (`ChannelView.swift` `memberAvatars`) rather than
  the channel's own membership; `GET /v1/channels/:id/members` is the fix on both
  clients, and macOS already observes a member list it can reuse.

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

### 2026-07-25 — Fix: the new-DM button moved to the Direct messages header (#61)
- `[web]` The ✎ button lived next to the workspace name, where it read as a
  workspace action and sat nowhere near the DM list it affects. It's now a `+`
  in the **Direct messages** section header, mirroring the `+` on **Channels**
  directly above it. Same `sidebar-new-dm` testid, same `NewDmModal`.
- `[web]` `SectionHeader`'s action had a hardcoded `title="Create a channel"` —
  correct while Channels was the only caller, wrong the moment DMs reused it.
  `title` is now part of the `action` object; the DM button reads "New direct
  message".
- `[macos]` `[ios]` No change — native already put this in the Direct messages
  section header (`SidebarView.swift`, `sidebar.newDM`). This closes the gap
  rather than opening one. Native keeps its pencil glyph and web uses `+` to
  match its own Channels header: deliberate, not a Parity item.
- The workspace header is now just the workspace menu, so its name gets the
  full sidebar width to truncate into.

### 2026-07-25 — Feature: agents can create channels and invite members over MCP (#65)
- `[bridge]` Two new `flow` MCP tools, bringing the surface to 14:
  `create_channel` (`name`, optional `topic`/`isPrivate`) and
  `invite_to_channel` (`channelId` + **`userIds` array**). Agents could already
  join a public channel but had no way to set one up and pull people in.
- `[bridge]` `invite_to_channel` takes a list because `addMember` is
  one-user-per-call server-side — batching moves that loop below the MCP
  boundary instead of burning an agent turn per person. Adds are independent:
  the result names who was added and, per failure, why ("invited <@a>, <@b>" +
  a `failed:` block). `isError` is set only when *nobody* was added, so a
  partial success doesn't read as a failure. Dedupes ids, caps at 50.
- `[bridge]` `create_channel` on a duplicate name returns the **existing
  channel's id** ("use it instead of creating one") by looking it up in
  `list_channels`, so the agent can proceed instead of retrying blind. Falls
  back to a plain conflict message when the existing channel isn't visible to
  the agent (a private one it isn't in).
- `[bridge]` Private-channel invites report a merged reason. `requireChannelAccess`
  404s for a private channel the caller isn't in (membership privacy) *before*
  `addMember`'s `forbidden()` can fire, so the 403 that branch suggests is
  unreachable from outside — a bare "channel not found" would be misleading.
  New `inviteErrorText()` maps 404 → "channel not found, or it is private and
  you are not a member"; every other server code (`dm_channel`,
  `channel_archived`, `bad_user`) passes through as-is.
- `[bridge]` Package bumped to `0.9.0` — a published tool-surface change, so
  existing installs need it to pick the tools up (`currentVersion()` reads
  package.json, so the startup staleness warning follows automatically).
- `[bridge]` `FlowApi.createChannel()` / `addChannelMember()` in `api.ts`; the
  hardcoded tool list in `bridge.ts`'s system prompt learned both tools, or
  agents would never know they exist.
- `[server]` No change — `POST /v1/workspaces/:id/channels` and
  `POST /v1/channels/:id/members` already existed and already enforce this.
  Agents are ordinary workspace members, so no new authorization model.
- 4 new cases in `packages/server/test/agents.test.ts` (agent creates a public
  channel and is a member; agent adds a member, re-add is a no-op; the private
  channel rejection is asserted as **404, not 403**; duplicate name → 409
  `channel_exists` with the original id still resolvable). Also verified
  end-to-end by driving the MCP server over stdio against a live instance.
- Docs: tool tables in `docs/integrators/AGENT_MEMBERS.md` and
  `skills/flow-agent-member/SKILL.md`.

### 2026-07-25 — Fix: the channel header avatar stack now opens the member list (#70)
- `[web]` The header stack was explicitly decorative — no click handler, and for
  standard channels it rendered the whole **workspace roster**, which said
  nothing about who was actually in the channel. It's now a button, and it
  sources its ids from `useChannelMembers(channelId)`
  (`GET /v1/channels/:id/members`, already permission-checked by
  `requireChannelAccess`) for every channel kind. The DTO's `memberIds` — DM-only
  — stays as the fallback while that fetch is in flight, so DM headers don't
  flash empty.
- `[web]` New `ChannelMembersPopover` (`packages/web/src/components/`): avatar,
  name, 🤖 badge, status emoji/text and a presence dot per row; online members
  sort first, then alphabetically. Clicking a row opens that user's `UserCard`
  via the existing `setCardUserId`. Dismisses on outside pointerdown or Esc;
  the trigger is exempted from the outside-click (`data-members-trigger`) so its
  own click toggles instead of reopening. Switching channels closes it.
- `[web]` Kept the popover presentational (rows in, `onSelect`/`onClose` out) —
  ChannelView owns the fetch, the presence lookup and the card handoff. You're
  always shown online (this client is the connected one) and tagged "(you)".
- New `packages/web/src/components/ChannelMembersPopover.test.tsx` (5 cases):
  ordering rule + no input mutation, row render with agent/status, the "(you)"
  marker and count singularization, loading vs empty state.
- `[server]` No change — the endpoint already existed.
- `[macos]` `[ios]` Not ported; see Parity.

### 2026-07-24 — Fix: your own messages counted toward the unread badge (#71)
- `[server]` The per-channel unread query in `listChannels` counted every
  non-deleted, non-system, top-level message newer than `lastReadMsgId` with no
  author filter, so a message you sent badged your own channel until the read
  cursor caught up — which it never does when you send from one client and look
  at the sidebar on another. Added `ne(messages.userId, userId)` to the
  condition: you can't have unread mail from yourself, in a DM or anywhere else.
- `[server]` `sendMessage` now advances the sender's `lastReadMsgId` for
  top-level posts (`greatest(lastReadMsgId, <id>)`, so it never moves
  backwards) — posting in a channel means you've seen what's above it. Thread
  replies leave the channel cursor alone; they don't count toward it either.
- `[server]` Notification rows were already correct — `computeRecipients`
  skips the sender — so the notification unread count needed no change.
- New `packages/server/test/unread.test.ts` (6 DB-backed cases): own DM/channel
  messages don't badge, the other party's still does, a null cursor doesn't
  resurrect your own messages, sends advance the cursor, replies don't.
- `[web]` `[macos]` `[ios]` No client change — the web sidebar renders the
  server count, and macOS already skips its local increment for own messages.

### 2026-07-24 — Fix: iOS keyboard stayed up over the drawer and message list (#69)
- `[ios]` Composer focus is a `@FocusState private var` inside `ComposerView`,
  so nothing outside it could drop the keyboard: opening the channel drawer
  slid it over a raised keyboard, and tapping the message list did nothing.
  New `Sources/Platform/Keyboard.swift` adds a `dismissKeyboard()` (app-wide
  resign-first-responder) plus a `dismissesKeyboardOnTap()` view modifier.
- `[ios]` `MainView.openDrawer()` dismisses before opening; `ChannelScreen`
  and `ThreadScreen` apply the tap modifier to their message lists. It uses
  `simultaneousGesture`, so message taps, links and long-press actions still
  work. Both lists also gained `.scrollDismissesKeyboard(.interactively)` for
  drag-to-dismiss.
- `[web]` `[macos]` Not applicable — no software keyboard.
- `[qa]` First iOS UI-test target (`apps/ios/UITests`, XCUITest via a new
  `FlowUITests` target in `project.yml`) — taps run inside the simulator, so
  unlike the macOS AX harness they don't need an idle desktop.
  `KeyboardDismissTests` encodes both acceptance criteria; it fails on the
  pre-fix code (keyboard still up after both gestures) and passes after.
  Composer's `TextField` gained a `composer.input` identifier to drive it.
  Setup + run instructions in `apps/ios/UITests/README.md`.

### 2026-07-24 — Fix: the mini-browser's Go button didn't reload the page
- `[web]` `LinkPane.go()` bailed out when the normalized URL matched the one
  already pinned (`next === url`), because the only job it knew about was
  PATCHing the artifact. With an unchanged address that meant no PATCH, no
  `artifact.updated` echo, and — since the iframe is keyed on `url` — no
  remount: pressing **Go** (or Enter) on the current page did nothing at all.
  The same-url case now bumps a `reloadNonce` that feeds the iframe key, so the
  page reloads locally; the block-hint timer restarts with it. Only a genuine
  url change still broadcasts, so a reload doesn't spam co-browsers.
- `[macos]` Same bug, same shape: `broadcast()` guards on `next != url`, so
  Enter on the current address was a no-op. Submitting the shown url now bumps a
  `reloadToken` that `CoBrowserWebView` turns into a fresh `load()` of the
  shared url — which also pulls the web view back from wherever in-page clicks
  wandered. The reload's `didCommit` matches `lastLoaded`, so it isn't
  re-broadcast.
- `[ios]` Unaffected — no artifacts UI there yet (tracked under Parity).

### 2026-07-24 — Fix: the native Google handoff opened a second Flow window
- `[macos]` **The production bug.** `RootView`'s `.onOpenURL` sits inside a
  `WindowGroup` that never declared `handlesExternalEvents`, so when a running
  app received a `flow://` URL, SwiftUI spawned a *second* window to service it.
  The Google handoff hit this every time — you press that button from inside a
  running app, so the callback always arrived at a live instance. The sign-in
  itself was fine (`onOpenURL` fired in the new window), you just got a
  duplicate. The window group and its root view now claim external events, so
  the URL goes to the window already open. Also fixes the same duplicate on
  `flow://invite/…`, which had it all along.
- `[web]` Separately, and dev-only: the `/?native=google` page auto-fires the
  handoff from an effect, and `StrictMode` deliberately double-invokes effects in
  development — so on the Vite dev server it minted two single-use app-link
  codes and navigated twice. Guarded with an in-flight latch, cleared when the
  attempt settles so the retry button still works. A handoff should never
  overlap itself whatever triggers it.
- `[web]` Also dev-only: GIS `renderButton` appends rather than replaces, so the
  double-invoked effect stacked two Google buttons. The slot is cleared first.
- `[ios]` Unaffected — one window, so there is no second one to spawn.

### 2026-07-24 — Phase 16: Sign in with Google + domain self-registration
- `[server]` `POST /v1/auth/google` takes a Google **ID token** (the GIS
  ID-token flow — no client secret, no redirect URI, no server-side exchange)
  and verifies it with `google-auth-library` against Google's rotating JWKS,
  checking issuer, `aud` and expiry. A verified payload resolves to a Flow user
  by `(provider, sub)` first, then by verified email, else creates one — so an
  existing password account with the same address is **linked**, never
  duplicated, and a later Google email change still lands on the same user.
  A Google-first account has a real verified email and an unusable
  `!google:…` password sentinel (the same trick bots and agents use).
  An unverified Google email is refused (`403 email_unverified`), as is an
  address that belongs to a bot or agent (`409 email_reserved`). The response
  is a normal session, so logout, sliding expiry and revocation are unchanged.
- `[server]` New `oauth_identities` table (migration `0023`) — provider-agnostic,
  keyed on `(provider, provider_subject)`, storing the verified email and Google
  hosted domain, both refreshed on every sign-in. Workspaces gain
  `google_self_register_domain`: when set, any Google user with a verified email
  on that domain self-enrolls on sign-in (member row + `#general` +
  `member.joined`) with no invite. The join primitive is now shared with invite
  accept as `enrollInWorkspace()`. Set/cleared via `POST /v1/workspaces` or
  `PATCH /v1/workspaces/:id`, owner/admin only, and only for the setter's *own*
  verified Google email domain; consumer domains (`gmail.com`, `outlook.com`, …)
  are denied outright, and by default the account must be a Google Workspace
  account on that domain (`FLOW_GOOGLE_REQUIRE_HD=0` to relax — see
  decision_log 2026-07-24). Google's `picture` seeds the avatar only when the
  user has none, fetched through the normal avatar pipeline rather than stored
  as a foreign URL.
- `[server]` New public `GET /v1/config` (`{ google, googleClientId }`) so the
  signed-out client knows which auth options exist, and
  `GET /v1/me/identities` so the client knows whether to offer the domain
  toggle. With `GOOGLE_CLIENT_ID` unset, `/v1/auth/google` returns
  `503 google_disabled` and nothing else changes.
- `[web]` A **Continue with Google** button on both the Sign In and Register
  panels — with Google the two are one operation — rendered only when the
  server says Google is configured. A pending emailed invite is still accepted
  after a Google sign-in, exactly as after an email registration. When the
  sign-in auto-enrolled the user into workspaces on their domain, the app lands
  them in one and says so instead of showing the empty create-workspace screen.
- `[web]` Create Workspace offers **"Let anyone with an @acme.com email join
  this workspace automatically"** to a creator who signed in with Google on a
  non-consumer domain — their own domain only, never free text. The same toggle
  lives in the Invite People dialog for an existing workspace.
- `[macos]` `[ios]` **Continue with Google** on the sign-in screen, shown only
  when the server reports Google is configured (`GET /v1/config`; a failed check
  hides it rather than offering a button that can't work). Neither app carries a
  Google SDK: the button opens the system browser at the new `/?native=google`
  handoff page, which runs GIS, signs in, mints a one-time app-link code and
  returns via `flow://signin?code=…` — the deep link both apps have handled
  since phase 3, so there's no new native crypto and no second OAuth client.
  Arriving at that page with a live web session skips the Google step and hands
  off immediately.
- `[web]` New `/?native=google` handoff page behind the above, with an "Open the
  Flow app" retry and a Download-for-Mac fallback when the deep link doesn't
  take. Unlike the emailed one-shot tokens the `native` param stays in the URL,
  so reloading the page is still the handoff page.
- Parity: Google sign-in is now on all three clients. The native route is a
  deliberate divergence (browser handoff vs in-page GIS) — see Deliberate
  divergences. The domain-self-registration *result* was never client-specific:
  it keys off the account, so it fires on a native user's next sign-in whatever
  they signed in with.

### 2026-07-24 — Fix: alphabetical Direct messages list across all clients (ui_nits)
- `[web]` The Direct messages list is alphabetical again for everyone. The
  earlier sort only ordered real DM channels; the virtual agent rows (agents
  with no existing 1:1 DM) were a separate list rendered *below* them, so they
  always piled up at the bottom out of order. Now DM channels and agent rows are
  merged into one list sorted by display title before rendering.
- `[macos]` `[ios]` The DM list was never sorted (the channels query orders by
  `name`, which is null for DMs). Both native sidebars now sort DM channels by
  resolved display title, case-insensitive — matching web. (Native has no
  virtual agent rows, so there's nothing extra to merge.)
- `[web]` `[macos]` `[ios]` The self-DM ("<you> (you)") is now pinned to the
  bottom of the Direct messages list on all clients — it's a personal scratchpad,
  not a conversation, so it sinks below everyone else regardless of name.

### 2026-07-24 — iOS: passwordless "Email me a sign-in link" on the sign-in screen
- `[ios]` The sign-in screen gains an **Email me a sign-in link** button beside
  Sign In — enabled on a plausible email alone (no password). It calls the
  existing `POST /v1/auth/signin-link` and swaps the form for a neutral "check
  your email" confirmation (no account enumeration — same contract as web).
- `[ios]` Shared `SyncEngine.sendSigninLink(email:)` + `SigninLinkBody`; the
  engine method is available to macOS too, only the UI is iOS-only so far.
- Known limitation: the emailed link is a web URL (`app.flowtoo.org/?signin=…`),
  so tapping it on the phone signs you in **on the web**, not the native app —
  fully-native tap-to-open needs Universal Links (see Parity › Gaps to close).

### 2026-07-24 — Phase 15 update: one-time agent invite codes (device-code pairing retired)
- **Invite codes replace sponsor-approval pairing.** The **Invite your Agent**
  dialog is now operable: opening it mints a **one-time invite code** for the
  current workspace (sponsor = you) and shows the exact command,
  `npx flow-agent-bridge <code>`, with a copy button. No email to type, no
  approval popup. `[web]`
- **Immediate join, random avatar.** `POST /v1/agents/redeem` trades the code
  (which carries the sponsor + workspace) plus the agent's durable credentials
  for a token synchronously: the agent user is created, assigned a **random**
  preset avatar (the sponsor can change it in-app afterwards), joined to the
  workspace + `#general`, and announced with the usual join notice — all in one
  request. Codes are single-use and expire in 7 days. `POST
  /v1/workspaces/:id/agent-invites` mints them (any member). `[server]`
- **Removed**: the device-code flow end to end — `agent_pairing_requests`
  (dropped in migration `0022`), the `agent.pairing` WS event, the register/poll/
  approve/deny routes and the `/v1/agent-avatars` picker, the web
  `AgentPairingPrompt` approval popup and `useAgentRequests` hook, and the
  bridge `register` subcommand. `[server]` `[web]` `[bridge]`
- **Bridge**: `npx flow-agent-bridge <invite-code>` redeems and runs in one go;
  setup prompts for the code (if not passed) then name/handle/harness and joins
  immediately — no wait. Flags: `--invite --name --handle --harness --server
  --token --description --cwd`. Package bumped to `0.8.0`; README updated.
  `[bridge]`
- Tests: server invite mint/redeem/single-use/expiry/unknown-code/taken-username
  coverage; bridge invite-code validator; web render test that the dialog shows
  the generated command. `[server]` `[bridge]` `[web]`

### 2026-07-23 — Phase 15: "Invite your Agent" + streamlined bridge setup
- **Sidebar CTA**: a new **Invite your Agent** button sits just above the profile
  footer. It opens a dialog explaining the one command (`npx flow-agent-bridge`),
  names the current user as the sponsor to enter, and shows a static preview of
  the pairing-approval prompt so people know what to expect. The dialog
  **auto-closes** the moment a live pairing request naming this user as sponsor
  arrives (the agent self-registered) — `AgentPairingPrompt` takes over. `[web]`
- **Streamlined `npx flow-agent-bridge` setup**: first-run setup now asks only
  the four things a person must decide — **agent name, handle, sponsor email,
  harness** — UP FRONT, then registers and waits for approval, then saves
  `agent.json` and starts the daemon. Server URL, an existing token to reuse, a
  description, and the working directory each have a sensible default (cwd
  defaults to where the command ran) and are overridable with flags
  (`--name --handle --sponsor --harness --server --token --description --cwd`),
  so the flow is fully scriptable / non-interactive. Package bumped to `0.7.0`;
  README updated. `[bridge]`
- The **Agents…** modal and README drop the old
  `npm install -g flow-agent-bridge && …` line in favor of the single
  `npx flow-agent-bridge`. `[web]` `[bridge]`
- Tests: bridge unit coverage for the no-TTY guard and the flag validators
  (harness, handle); a web render test that the dialog shows the command, the
  sponsor email, and the prompt preview. `[bridge]` `[web]`

### 2026-07-23 — Join/leave system messages in the channel stream (ui_nits)
- Joining or leaving a standard channel posts an inline "X joined/left the
  channel" notice, so membership changes are visible in the timeline and reach
  every session (they ride the normal `message.created` broadcast — closing the
  "add an agent, it only shows in one place" gap). `[server]` `[web]` `[macos]` `[ios]`
- `[server]` New `messages.system_kind` column (migration `0021`) tags a row as a
  channel event line vs a user message. `postSystemMessage()` inserts an
  encrypted, pre-rendered sentence authored by the subject user; it makes no
  notifications, no Slack-events outbox rows, and no unfurls, is best-effort
  (never aborts the membership write), and only fires for standard channels.
  Hooked into join / add / remove and the agent-sponsor path (agent joins
  #general). System lines are excluded from unread counts. Test coverage in
  `systemMessages.test.ts`.
- `[web]` `[macos]` `[ios]` The message list renders a system line as a centered
  muted notice (no avatar/header) and breaks author grouping around it.
  `MessageDTO.systemKind` (shared) drives it; native adds `Message.systemKind`
  (GRDB migration `v10`) and a SyncEngine guard so a system line never bumps the
  local unread count.
- `[macos]` `[ios]` Fixed a pre-existing iOS link break surfaced by this work:
  the `FileAttachment` file-kind extension (isVideo / artifactGlyph / …) moved
  from macOS-only `Views/FilePreviews.swift` into shared `Models.swift`, since
  `Artifact.glyph` (shared) depends on it and the iOS target excludes the macOS
  Views. Both apps build clean; no parity gap — system messages are at full
  client parity.

### 2026-07-23 — UI nits: composer-based message edit, self-DM & DM-list polish
- `[web]` Editing a message now **reuses the prompt editor** instead of the inline
  `<input>` box (ui_nits). ↑ in an empty composer, and the ✏️ hover action, both
  load the message body into the composer; Enter saves via `PATCH /v1/messages/:id`,
  Esc/Cancel restores the in-progress draft, and the row being edited is highlighted
  in the stream. Works in both the channel and thread composers.
- `[web]` The **self-DM** ("<you> (you)") row no longer shows an unread badge — you
  can't have unread messages from yourself (ui_nits).
- `[web]` **Direct messages sort alphabetically** by display title, case-insensitive
  (ui_nits).
- Parity: these three are web-only UI nits. macOS/iOS carry the pre-existing inline
  edit and unsorted DM list — see Parity › Gaps to close.

### 2026-07-23 — Link artifacts: pin a link as a co-browsing artifact
- Artifacts gain a second **kind**: `link` (a pinned URL) alongside the existing
  `file`. New migration `0020_artifact_links.sql` makes `file_id` nullable and
  adds `kind` + `url` with a CHECK that a `file` row carries `file_id`/no `url`
  and a `link` row carries `url`/no `file_id`; link pins are idempotent per
  `(channel_id, url)`. `ArtifactDTO.file`/`fileId` are now nullable and `kind`
  /`url` are added; `POST /v1/artifacts` accepts `{channelId, url}` and
  `PATCH /v1/artifacts/:id` accepts `{url}` (the co-browse write). All joins on
  `files` became LEFT joins so link artifacts survive listing. `[server]`
- Any link in chat now offers **Pin as artifact** — a 📌 on the unfurl preview
  card and on every bare inline link (revealed on hover). Pinning opens the link
  in a **mini-browser** in the side panel: an editable URL bar above the page.
  `[web]` `[macos]`
- **Co-browsing**: changing the URL (typing in the bar on any platform, or
  clicking an in-page link in the native macOS web view) re-points the shared
  artifact via `artifact.updated`, so every channel member's mini-browser
  follows in real time. Received updates apply without re-broadcasting (no echo
  loop); the web client seeds the updated DTO into its cache so the follow is
  instant. `[server]` `[web]` `[macos]`
- macOS uses a native `WKWebView` (`LinkArtifactView`) — no framing limits, and
  a navigation delegate keeps the URL bar in sync with in-page navigation. Web
  uses a sandboxed `<iframe>` with a best-effort "this site can't be embedded —
  Open in new tab" fallback. `[web]` `[macos]`
- Tests: server unit coverage for link create/idempotency/url-shape/co-browse
  update/kind-guard/delete; a web test that inline links expose the pin
  affordance only when a channel provides the handler. `[server]` `[web]`

### 2026-07-23 — Downloadable macOS app + "not installed" fallback
- The signed-out page now links to **Download the Mac app**. New public server
  route `GET /download/mac` 302s to a short-lived presigned URL for the
  notarized DMG stored in R2 at key `downloads/Flow.dmg` (falls back to proxying
  bytes on the local disk driver; `404 not_found` until the object exists). No
  auth — it's the logged-out surface. `[server]` `[web]`
- The "Open the app" CTAs (workspace-chooser button + signed-in banner) now
  detect when the native app **isn't installed** and offer a download link
  instead of failing silently. Setting `location.href = flow://…` never rejects
  when no scheme handler exists, so the old `.catch()` never fired; the new
  heuristic watches for the page backgrounding (blur/visibilitychange) after the
  scheme is triggered and, if it doesn't within 1.5s, surfaces "Download for
  Mac". `[web]`
- Ops: `apps/macos/tools/publish-dmg.sh [--build]` builds (via dist.sh) and/or
  uploads the DMG to R2 at `downloads/Flow.dmg` — reads `CLOUDFLARE_*` from
  `.env`, maps them to the `AWS_*` names the AWS CLI reads (it ignores
  `CLOUDFLARE_*`, so a bare `aws s3 cp` grabs a stray AWS key → "length 20,
  should be 32"), and opts out of the CLI v2 checksums R2 rejects. Overwriting
  the key ships a new build with no code deploy. docs/ops/DEPLOYMENT.md § macOS
  app download. `[qa]`
- Ops: `dist.sh` now also notarizes and staples the **`.dmg` itself** (not just
  the app inside it), so mounting a downloaded DMG is offline-clean with no
  "downloaded from the Internet" prompt — Apple's recommended practice of
  notarizing the final artifact. Adds one notary round-trip; the submit+verdict
  logic is factored into a `notarize()` helper shared by the app zip and the
  DMG. `[qa]`
- Ops: the DMG now opens as a **drag-to-install window** — Flow icon on the
  left, an Applications alias on the right, and an arrow between them over a
  branded background. Built headlessly with `dmgbuild` (writes the window
  `.DS_Store` directly, no Finder/AppleScript) replacing the plain `hdiutil`
  step; the background is generated from `tools/make-dmg-bg.swift`
  (`Resources/dmg-background.png` + `@2x` for a crisp HiDPI TIFF), layout in
  `tools/dmg-settings.py`. One-time: `pip3 install --user --break-system-packages
  dmgbuild`. `[qa]`

### 2026-07-23 — iOS: channel list is now a slide-in drawer (web mobile parity)
- The iOS channel list moves from a drill-down `List` (tap a channel → push a
  screen; tap "‹ Back" to change channels) to the web client's **mobile drawer**
  layout: the conversation fills the screen and the sidebar slides in over it
  from the left — a 64px workspace rail plus the violet gradient
  channel/DM/browse list — opened from a header hamburger and dismissed by the
  backdrop or a selection. The visible pane is now driven by `AppState`
  (`selectedChannelId` / `showActivity`), the same selection model macOS and web
  use, instead of a `NavigationStack` of channel ids (threads still push onto the
  content pane's own stack). New `SidebarDrawer.swift` ports the macOS
  `SidebarView` rows (active-channel pill, unread badges, presence dots, section
  headers) for touch; the profile/status footer and account/status sheet move
  into the drawer footer where web + macOS keep them (the per-channel nav-bar
  account button is retired). A rail "+" adds a workspace (create or accept an
  invite) via the new iOS `AddWorkspaceSheet`. `[ios]`
- Fix: the iOS build was broken on `main` — PR #38 changed the shared
  `Banners.show` signature (it now takes the `NotificationItem` so the macOS
  banner tap can navigate) but the iOS no-op stub still had the old
  `show(title:body:id:)` signature. Synced the stub's signature. `[ios]`
- QA: `FLOW_DEBUG_OPEN_DRAWER=1` opens the channel drawer on launch so the
  simulator can be screenshot-verified without a tap tool (DEBUG-only). `[qa]`

### 2026-07-23 — Notification banners are now clickable (web + macOS)
- Clicking a browser (OS) notification banner from the web client now focuses
  the tab and jumps straight to the triggering message — selecting the right
  workspace/channel, opening the thread for a reply, flashing the message, and
  marking the notification read — the same navigation the in-app Activity list
  already does. Previously the banner had no `onclick`, so clicking it did
  nothing beyond the browser default. `[web]`
- The native macOS app now does the same: `AppDelegate` becomes the
  `UNUserNotificationCenterDelegate`, `Banners.show` carries the
  workspace/channel/message/thread ids in the banner's `userInfo`, and a tap
  activates the app and calls `AppState.openNotification(...)` — the same jump
  Activity-row taps use. A tap that arrives before the UI is wired up (cold
  launch) is buffered and replayed once `AppState` attaches. The delegate's
  `willPresent` also lets banners show while Flow is frontmost (SyncEngine
  already suppresses them for the channel you're viewing, so it's never noise).
  Previously the app registered no delegate, so a tap just activated the app
  and foreground banners were silently dropped. `[macos]`

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
