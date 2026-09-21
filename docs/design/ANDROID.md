# Android client (PROPOSAL)

The README lists Android among the platforms with development plans for
native clients. This document proposes a different *sequencing* for the
Android half of that — ship the existing web client in a thin native shell
first, and keep native as the exit ramp — and suggests a phasing to a Play
listing.

Status: proposal, revised 2026-09-07 against current `main`. The route
question was ruled in the PR discussion (#228): the maintainer is open to the
Capacitor approach, and noted that if it works well it may also be the path
for a Windows client. The remaining open questions at the end still need
rulings before phase 0 starts. Nothing here is built yet.

## The principle: ship the web client, keep the native door open

Android is the one platform where our existing assets point away from the
iOS recipe. The iOS app was cheap because it compiles the macOS app's entire
platform-agnostic Swift stack verbatim (`IOS.md`: models, GRDB cache,
APIClient/SocketClient, SyncEngine — "new server features light up on iOS
with view work only"). Kotlin inherits none of that: a native Android client
starts from zero on models, networking, cache, and sync — the subtlest code
in any client — and then becomes a **third independent implementation** of
every behavioral rule we have (author grouping, typing expiry, unread
precedence, thread participation). Three hand-written sync engines will
drift, and the drift lands in the Parity ledger forever.

What Android *can* inherit is `packages/web`: React 19 + TanStack Query, a
small runtime-dependency set, and an already-supported mobile layout (the
767px drawer mode). So the proposal is: **bundle the web client in a
Capacitor shell** — the system WebView plus thin native plugins for the
things a chat app cannot fake on Android: push (FCM), deep links, a share
target, back-button/IME handling, and — new since the first draft — the
microphone and foreground-service plumbing that voice huddles need. Roughly
10 engineer-weeks to a Play listing, ~95% of it reused or reusable.

This stays consistent with the README's no-Electron stance: Capacitor ships
no browser — it uses the OS WebView (~3 MB overhead), the same way a TWA
does, but with full native API access. The divergence from the fully-native
ethos of the macOS and iOS apps is real, though, and should be recorded as a
deliberate, revisitable ruling in `decision_log.md` when phase 0 lands.

## Routes evaluated

| | TWA / PWA wrapper | **Capacitor shell (proposed)** | Native Kotlin / Compose |
|---|---|---|---|
| What ships | Play-packaged Chrome tab pointed at the server | web dist bundled in the APK, system WebView | ground-up Compose app |
| Reuse | 100% (nothing shipped) | ~95% of `packages/web` | Zod schemas as reference only |
| Push | Web Push only — the server sends APNs, not Web Push | full FCM, via the existing `PushSender` seam | full FCM |
| Huddles | browser WebRTC, no background audio | `livekit-client` in the WebView + native mic/foreground service | LiveKit Android SDK |
| Deep links / share target | limited, origin-bound | full (`flow://`, App Links, ACTION_SEND) | full |
| Offline | none | none (same as web — Parity entry) | Room/SQLDelight cache, iOS-class |
| Cost | ~1 wk | ~10 wk | 4–6 months |

A TWA cannot deliver notifications — disqualifying for chat. Native Kotlin
is the best end state but forfeits the one reusable asset and delays a
usable app by months; it stays on the roadmap as the exit ramp below, not a
competitor. Nearly everything Capacitor forces us to build — CORS, a
configurable API base, the FCM driver, verified App Links, the Play listing
and release script — carries over unchanged if a native client is built
later.

## Architecture

```
┌─ APK ──────────────────────────────────────────────┐
│  Capacitor shell (Kotlin, thin)                    │
│  ├─ FCM push service ── taps → deep-link intents   │
│  ├─ Intent filters: flow:// + https App Links      │
│  ├─ Share target (ACTION_SEND → composer)          │
│  ├─ Mic permission + huddle foreground service     │
│  └─ System WebView                                 │
│      └─ packages/web dist (bundled at build time)  │
│          fetch/WS → configurable apiBase           │
│          livekit-client → LiveKit (huddles)        │
│          <iframe> → mini apps (agent-hosted)       │
└──────────────────────┬─────────────────────────────┘
                       │ HTTPS /v1 · WSS /v1/ws
                       ▼
        any Flow server (app.freeflow.im or self-hosted)
        └─ LiveKit project, when the server has LIVEKIT_* set
```

## What must change first: the same-origin coupling

Two facts block *any* packaged web client today, and they are phase 0:

1. `web/src/lib/api.ts` fetches relative paths and `ws.ts` builds its socket
   URL from `location.host` — the client assumes it is served *by* the API
   server. Fix: an `apiBase` config consulted by both; default stays
   same-origin so the web build is byte-for-byte unaffected; the app build
   injects the chosen server URL.
2. The server has no CORS layer (one origin by design — it never needed
   one). Fix: `@fastify/cors` behind a config flag, allowlisting the app
   origins (`https://localhost` / `capacitor://localhost`), off by default
   for pure-web deployments. Auth is already a Bearer header, not cookies,
   so no credentialed-CORS complexity.

Token storage moves behind a two-method interface: `localStorage` on web,
Capacitor secure storage in the app.

Both facts were re-checked against `main` on 2026-09-07 and still hold.

## What landed since the first draft

Two features shipped between the first draft and this revision that a
packaged web client has to carry, and that change the phasing below.

**Voice huddles.** The web client joins huddles through `livekit-client`
against a LiveKit project the server is configured with (`LIVEKIT_URL`,
`LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`; huddles are simply absent when
those are unset, so a self-host without them behaves the same in the app as
on web). Agents take part too — the bridge can answer huddles and run the
voice through its Claude and Codex runtimes (#503, #504), and iOS already
shows an ongoing agent call (#499). For the shell this means:

- **Microphone.** `getUserMedia` inside the system WebView is denied unless
  the shell declares `RECORD_AUDIO` and grants the WebView's
  `onPermissionRequest`. Capacitor exposes this; it is shell work, not web
  work.
- **Background audio.** Android kills a backgrounded app's audio unless a
  foreground service with the `microphone` type is running (mandatory to
  declare on Android 14+). Without it a huddle drops the moment the user
  switches apps.
- **Audio routing** — earpiece, speaker, Bluetooth — is native-only; the
  web client cannot reach it. A small plugin, same shape as the iOS audio
  session handling.
- **Incoming ring while the app is closed** rides on the push channel from
  phase 3; the in-app ring already works (`huddleRing.ts`).

LiveKit also ships a native Android SDK, which is the fallback if WebView
audio proves unreliable on low-end devices — it slots into the exit ramp
without disturbing anything else.

**Mini apps.** `MINI_APPS.md` — authenticated, agent-hosted apps behind link
artifacts. Web renders them in a sandboxed `<iframe>` in the side panel;
iOS opens them inline; neither native client co-browses one. The iframe
works in the WebView as-is, and the app-guard handshake runs against
`apiBase` like every other call. Two shell details: the sandbox allows
popups, which the WebView only honors if the shell handles
`onCreateWindow`; and the mobile side-panel layout is a web question, not
an Android one. Proposed posture: match iOS — open inline, no co-browse.

## Suggested phasing

**Phase 0 — decouple** (~1 wk) `[server]` `[web]`
apiBase + WS URL derivation; CORS flag; token-storage seam; `apps/android`
scaffold consuming `packages/web/dist`; CI debug APK on PRs touching
`apps/android/**` or `packages/web/**`.
*Exit: bundled client signs in and chats against a local server from the
emulator, over CORS.*

**Phase 1 — MVP shell** (~2 wk) `[android]` `[web]`
First-run server picker (default `app.freeflow.im`, editable — same posture
as the native apps); hardware back mapped to thread → channel → drawer;
IME/keyboard resize in the composer; status-bar tint from the workspace
theme; WebView file chooser wired to camera/photos/documents (the existing
`<input type=file>` paths then just work); downloads to `Downloads/`; WS
reconnect on network change and foreground.
*Exit: daily-driver QA checklist on a physical device against production —
the iOS phase-7 bar.*

**Phase 2 — deep links & OAuth** (~1 wk) `[android]` `[server]`
`flow://` intent filters (signin handoff via `app_link_codes`, invites);
verified https App Links for `/join/…` — needs the server to serve
`assetlinks.json`, config-driven so self-hosts get it too. Google blocks
OAuth in WebViews, so in-app Google sign-in goes through a Chrome Custom Tab
returning via App Link; v1 fallback is the browser handoff we already have.

**Phase 3 — push over FCM** (~1.5 wk) `[server]` `[android]`
The server half has largely landed since the first draft: the
`device_tokens` registry (migration 0040), register/unregister, and the
`PushSender` seam with a dev driver and an APNs driver selected by
`FLOW_PUSH_DRIVER`. Android adds an **FCM HTTP v1 driver behind the same
interface** — same recipient set, same `suppressAlert` gate, no forked
decisions. Two schema notes for that PR: `platform` currently documents only
`'ios'`, and `environment` (sandbox/production) and `bundle_id` (APNs topic)
are APNs concepts with no FCM equivalent — they should become per-platform
details rather than required columns so an `'android'` row is not shaped
like an iOS one. And the driver setting becomes a per-platform selection
rather than one global choice, since a mixed fleet needs both senders live.
App side: token registration on sign-in, notification channels per kind
(DM / mention / thread reply / incoming huddle — OS settings become the
per-kind mute UI for free), tap-through deep links, foreground suppression
stays the client's call (same principle as `willPresent` on iOS).
*Exit: locked phone gets a DM push; DND set on web silences it; tap lands in
the right thread.*

**Phase 4 — huddles & mini apps** (~2 wk) `[android]` `[web]`
Mic permission plumbing; huddle foreground service (`microphone` type) so a
call survives backgrounding; audio-route plugin; incoming-huddle push kind
and full-screen intent on tap; `onCreateWindow` for mini-app popups. Verify
`livekit-client` on the oldest supported WebView and on a low-end device —
this is where the LiveKit native SDK becomes the fallback if it has to.
*Exit: join a huddle with an agent, switch apps, come back, still
connected; open a mini app from an artifact.*

**Phase 5 — share target & polish** (~1 wk) `[android]`
ACTION_SEND / SEND_MULTIPLE for text, links, images, video, documents →
channel picker → composer (mirrors the iOS share extension, #214/#221).
Perf pass: cold start, long-channel scroll, low-end devices, Doze behavior
(push carries the burden when the socket is dead).

**Phase 6 — release engineering** (~1 wk + Play review lead time) `[android]` `[qa]`
Play Console app, Play App Signing, internal-testing track first. Versioning
follows the tag-driven ruling (#217): a `release-android.sh` reads the
**live Play track**, adds one, builds that commit, tags `android-v<n>` after
the upload succeeds — no version bumps in feature PRs, ever. Process wiring:
`[android]` joins the changelog platform tags, an Android box joins the PR
client-impact checklist, BUILD.md gets an Android section, and the Parity
ledger gets "Android: online-only, no offline cache — deliberate v1
divergence."

Phases 0→2 are sequential. The FCM driver (phase 3's server half) is
server-only work that can run in parallel from phase 1. Phase 4 needs
phase 1's shell, and phase 3 for the ring-while-closed case. Phase 0's
refactor, the FCM driver, and the share target are scoped tightly enough to
run as `ai_prompt` issues.

## Risks

- **Play UGC policy.** Play requires user-generated-content apps to ship
  in-app content reporting and user blocking. Flow has neither yet — owner/
  admin permanent delete (`PERMANENT_MESSAGE_MODERATION.md`) is part of a
  moderation story but is not user-initiated reporting. Product work, not
  Android work, and it can gate the listing — an open question below.
- **Huddle audio in a WebView.** WebRTC in the system WebView is mature, but
  background audio, routing, and low-end device behavior are exactly where
  wrapped apps get uninstall-worthy reviews. Phase 4 tests this first; the
  LiveKit native SDK is the escape hatch.
- **Version skew.** The bundled dist can lag a continuously-deployed server.
  Mitigate with the additive-only API posture we already keep, plus a
  `publicConfig` minimum-client-version that prompts an update.
- **WebView spread.** OS WebView versions vary in the field; minSdk 26+,
  test on a low-end physical device, keep a WebView-beta emulator lane in CI.
- **Google OAuth in WebView** is the fiddliest single item; the browser
  handoff caps the damage at inconvenience.

## The exit ramp: native later, cheaper

If real usage hits the WebView's limits (offline cache, optimistic send,
scroll perf on huge channels, huddle audio), the native build inherits
everything above except the shell itself: CORS and apiBase discipline, the
FCM driver, verified App Links, the Play listing, release script, and QA
checklists. Three notes for that day, recorded now so they aren't relearned:

- **Kotlin Multiplatform is the serious version** of "native Android": one
  shared core (models, networking, SQLDelight cache, sync) with Compose on
  Android — and possibly SwiftUI calling the same core on iOS, at the price
  of rewriting the working Swift layer. Only worth it if native Windows +
  Android make a second shared core inevitable anyway.
- **Codegen the DTOs** either way: `@flow/shared`'s Zod schemas are already
  the source of truth — emit JSON Schema/OpenAPI and generate Swift/Kotlin
  models in CI, so cross-client drift becomes a compile error, not a Parity
  bug. Pair with live-server contract tests like the Swift suite already
  runs.
- **Huddles can go native piecemeal.** The LiveKit Android SDK can replace
  the WebView's `livekit-client` behind a bridge without touching the rest
  of the app — a useful half-step if audio is the only thing that hurts.

## Open questions for the operator

1. **The route itself** — ruled in #228: Capacitor shell, with the note
   that it may also serve Windows. Recorded here; the `decision_log.md`
   line should land with the phase-0 PR.
2. **UGC compliance** — minimal report-message endpoint + user blocking
   before the Play listing, or launch internal-track/sideload first and
   defer? (iOS will face the App Store's mirror-image rule too.)
3. **Push payload plaintext** — `PUSH_APNS.md` open question 1 applies to
   FCM identically; one ruling should cover both transports.
4. **minSdk / device floor** — proposal says 26+ (covers ~95% of devices);
   confirm. (The huddle foreground-service type is a targetSdk concern, not
   a minSdk one.)
5. **Huddles in v1** — ship the listing with foreground-only huddles and add
   the foreground service after, or hold the listing until phase 4 is
   complete? The agent-call use case argues for the latter.
6. **Mini apps in v1** — inline like iOS (proposed), or an open-in-browser
   handoff to start?

## Suggested first PR

This document, plus its changelog entry (#228). Phase 0 follows as its own
PR now that the route is ruled.
