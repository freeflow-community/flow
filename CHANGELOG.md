# Changelog

Convention: every feature/fix entry tags the platforms it landed on —
`[server]` `[web]` `[macos]` `[ios]` `[qa]`. A change that lands on one client
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
