# Android client (PROPOSAL)

The README has promised "Windows/Android coming soon" since the retheme. This
is a proposed route and suggested phasing for the Android half of that
promise.

Status: proposal. Nothing here is built yet. The route choice and the open
questions at the end need operator rulings before phase 0 starts.

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

What Android *can* inherit is `packages/web`: React 19 + TanStack Query, two
runtime dependencies, and an already-supported mobile layout (the 767px
drawer mode). So the proposal is: **bundle the web client in a Capacitor
shell** — the system WebView plus thin native plugins for the four things a
chat app cannot fake on Android: push (FCM), deep links, a share target, and
back-button/IME handling. Roughly 8 engineer-weeks to a Play listing, ~95%
of it reused or reusable.

This stays consistent with the README's no-Electron stance: Capacitor ships
no browser — it uses the OS WebView (~3 MB overhead), the same way a TWA
does, but with full native API access. The divergence from the fully-native
ethos of the macOS and iOS apps is real, though, and should be recorded as a
deliberate, revisitable ruling in `decision_log.md`.

## Routes evaluated

| | TWA / PWA wrapper | **Capacitor shell (proposed)** | Native Kotlin / Compose |
|---|---|---|---|
| What ships | Play-packaged Chrome tab pointed at the server | web dist bundled in the APK, system WebView | ground-up Compose app |
| Reuse | 100% (nothing shipped) | ~95% of `packages/web` | Zod schemas as reference only |
| Push | Web Push only — server has none | full FCM | full FCM |
| Deep links / share target | limited, origin-bound | full (`flow://`, App Links, ACTION_SEND) | full |
| Offline | none | none (same as web — Parity entry) | Room/SQLDelight cache, iOS-class |
| Cost | ~1 wk | ~8 wk | 4–6 months |

A TWA cannot deliver notifications — disqualifying for chat. Native Kotlin
is the best end state but forfeits the one reusable asset and delays a
usable app by months; it stays on the roadmap as the exit ramp below, not a
competitor. Nearly everything Capacitor forces us to build — CORS, a
configurable API base, the FCM fan-out, verified App Links, the Play listing
and release script — carries over unchanged if a native client is built
later.

## Architecture

```
┌─ APK ──────────────────────────────────────────────┐
│  Capacitor shell (Kotlin, thin)                    │
│  ├─ FCM push service ── taps → deep-link intents   │
│  ├─ Intent filters: flow:// + https App Links      │
│  ├─ Share target (ACTION_SEND → composer)          │
│  └─ System WebView                                 │
│      └─ packages/web dist (bundled at build time)  │
│          fetch/WS → configurable apiBase           │
└──────────────────────┬─────────────────────────────┘
                       │ HTTPS /v1 · WSS /v1/ws
                       ▼
        any Flow server (app.freeflow.im or self-hosted)
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

**Phase 3 — push over FCM** (~2 wk) `[server]` `[android]`
The server half is `PUSH_APNS.md` §"Server: the three pieces", built as
designed — the `device_tokens` table (its `platform` column takes
`'android'`), register/unregister REST, and the sender seam consuming
`publishNotifications` / `notifyReaction`: same recipient set, same
`suppressAlert` gate, no forked decisions. The FCM HTTP v1 driver lands
first; the APNs driver later slots into the same seam, **retiring most of
the standing iOS push gap's server work**. App side: token registration on
sign-in, notification channels per kind (DM / mention / thread reply — OS
settings become the per-kind mute UI for free), tap-through deep links,
foreground suppression stays the client's call (same principle as
`willPresent` on iOS).
*Exit: locked phone gets a DM push; DND set on web silences it; tap lands in
the right thread.*

**Phase 4 — share target & polish** (~1 wk) `[android]`
ACTION_SEND / SEND_MULTIPLE for text, links, images, video, documents →
channel picker → composer (mirrors the iOS share extension, #214/#221).
Perf pass: cold start, long-channel scroll, low-end devices, Doze behavior
(push carries the burden when the socket is dead).

**Phase 5 — release engineering** (~1 wk + Play review lead time) `[android]` `[qa]`
Play Console app, Play App Signing, internal-testing track first. Versioning
follows the tag-driven ruling (#217): a `release-android.sh` reads the
**live Play track**, adds one, builds that commit, tags `android-v<n>` after
the upload succeeds — no version bumps in feature PRs, ever. Process wiring:
`[android]` joins the changelog platform tags, a fifth box joins the PR
client-impact checklist, BUILD.md gets an Android section, and the Parity
ledger gets "Android: online-only, no offline cache — deliberate v1
divergence."

Phases 0→2 are sequential; phase 3's server half can run in parallel from
phase 1. Phase 0's refactor, the FCM sender, and the share target are
scoped tightly enough to run as `ai_prompt` issues.

## Risks

- **Play UGC policy.** Play requires user-generated-content apps to ship
  in-app content reporting and user blocking. Flow has neither. Product
  work, not Android work, and it can gate the listing — an open question
  below.
- **Version skew.** The bundled dist can lag a continuously-deployed server.
  Mitigate with the additive-only API posture we already keep, plus a
  `publicConfig` minimum-client-version that prompts an update.
- **WebView spread.** OS WebView versions vary in the field; minSdk 26+,
  test on a low-end physical device, keep a WebView-beta emulator lane in CI.
- **Google OAuth in WebView** is the fiddliest single item; the browser
  handoff caps the damage at inconvenience.

## The exit ramp: native later, cheaper

If real usage hits the WebView's limits (offline cache, optimistic send,
scroll perf on huge channels), the native build inherits everything above
except the shell itself: CORS and apiBase discipline, the push pipeline,
verified App Links, the Play listing, release script, and QA checklists.
Two notes for that day, recorded now so they aren't relearned:

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

## Open questions for the operator

1. **The route itself** — Capacitor shell as proposed, or hold for native?
   This is the ruling everything else waits on.
2. **UGC compliance** — minimal report-message endpoint + user blocking
   before the Play listing, or launch internal-track/sideload first and
   defer? (iOS will face the App Store's mirror-image rule too.)
3. **Push payload plaintext** — `PUSH_APNS.md` open question 1 applies to
   FCM identically; one ruling should cover both transports.
4. **minSdk / device floor** — proposal says 26+ (covers ~95% of devices);
   confirm.

## Suggested first PR

This document, plus its changelog entry. Phase 0 follows as its own PR once
the route question is ruled.
