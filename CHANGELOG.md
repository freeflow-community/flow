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

Archived by phase — the live file keeps only the Parity ledger and entries for
work after phase 16.

| Archive | Span | Contents |
|---|---|---|
| `CHANGES_ARCHIVE_PHASE1-11.log` | through 2026-07-22 | phases 1-11, up to and including URL unfurling |
| `CHANGES_ARCHIVE_PHASE12-16.log` | 2026-07-22 → 2026-07-26 | phases 12-16: #Activity feed, artifacts, signed macOS distribution, agent invites, Sign in with Google |

Entries below start after phase 16.

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
