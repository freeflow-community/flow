# Flow iOS

State of the native iOS client (`apps/ios`), how it's built, and how to run it
in the simulator or on a real iPhone in developer mode.

First landed 2026-07-20. This is the operator-facing overview; `apps/ios/README.md`
is the terse build cheat-sheet.

## Status: daily-driver parity (phase 7)

A native SwiftUI app (iOS 17+) at feature parity with the desktop clients for
core messaging and files. Verified in the simulator against the local QA
server (and previously production).

**Works today:**
- Sign in (email + password) against any Flow server
- Workspace switcher; channel + DM lists with unread badges
- Message list: authenticated avatars, timestamps, 5-minute author grouping,
  day dividers, scroll-to-bottom
- Rich markdown rendering (shared MarkdownBlocks): bold/italic/inline code,
  fenced code blocks, blockquotes, mention pills
- Long-press message actions: quick reactions, emoji picker sheet (grid +
  search), Reply in Thread, Edit (own, sheet), Delete (own, confirm)
- Reactions: chips with counts, tap to toggle, own-reaction highlight
- Threads: reply count + participant stack on parents; pushed thread screen
  with its own composer
- Typing indicators (both directions; 5s expiry, shared semantics)
- Composer: @-mention autocomplete chip bar; attachments via photo library,
  Files picker, and camera (device only); attachment bar with thumbnails
- Attachments in chat: image previews + lightbox with share, animated GIFs,
  QuickLook for text/PDF/everything else
- App-icon badge with the unread notification count
- Deep links: `flow://signin?code=…` (web-to-app handoff) and `flow://invite/…`

**Not yet ported**: push notifications (APNs — deferred to a follow-on phase;
needs server device-token registry + Apple push key + physical-device
testing; designed in `docs/design/PUSH_APNS.md`). In-app registration &
password reset stay web-only by design, same as macOS.

## Architecture: shared data layer

The iOS app **reuses the macOS app's entire platform-agnostic stack verbatim** —
it is not a rewrite. `project.yml` compiles these macOS sources directly into
the iOS target:

- `Models/` — DTOs + GRDB records
- `Networking/APIClient.swift`, `SocketClient.swift` — REST + WebSocket
- `Database/` — GRDB cache (`AppDatabase`, `DBObserved`)
- `Sync/SyncEngine.swift` — the sync/mutation engine
- `App/AppState.swift` — the `@MainActor` app-state orchestrator
- `Support/` — `Server`, `Keychain`, `ISO8601`, `UUIDv7`, `DesignTokens`,
  `MentionRendering`, `EmojiCatalog`, etc. (everything except AppKit-tainted
  `Banners`)

Only the iOS-specific pieces live under `apps/ios/Sources/`:
- `Platform/ImageLoader.swift` — UIKit (`UIImage`) port of the authenticated
  image loader + `AuthImage` view
- `Platform/Banners.swift` — no-op stub (no local notifications yet)
- `FlowApp.swift`, `Views/` — the touch UI (auth, channel list, channel
  screen, composer)
- `Platform/Debug*.swift` — DEBUG-only QA hooks (compiled out of release)

Consequence: new server features that ride the shared REST/WS/DTO layer light
up on iOS with view work only, no protocol re-implementation.

## Prerequisites

- macOS with **Xcode 16+** (developed against Xcode 26.3) and an iOS 17+
  simulator
- **xcodegen** (`brew install xcodegen`) — the `.xcodeproj` is generated from
  `project.yml` and is gitignored
- For a physical device: a free or paid **Apple Developer account** (a plain
  Apple ID works for personal dev signing)

## Generate the project

The Xcode project is not committed — generate it from `project.yml` first, and
re-run this whenever you add or remove a source file:

```sh
cd apps/ios
xcodegen generate      # creates FlowiOS.xcodeproj
```

## Run in the simulator

Via Xcode: `open FlowiOS.xcodeproj`, pick an iPhone simulator, Run (⌘R).

Headless via CLI:

```sh
xcodebuild -project FlowiOS.xcodeproj -scheme Flow \
  -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -derivedDataPath .build CODE_SIGNING_ALLOWED=NO build

APP=$(find .build/Build/Products -name Flow.app -path '*iphonesimulator*' | head -1)
xcrun simctl boot 'iPhone 17 Pro' 2>/dev/null
xcrun simctl install 'iPhone 17 Pro' "$APP"
xcrun simctl launch 'iPhone 17 Pro' org.flowtoo.ios
```

`CODE_SIGNING_ALLOWED=NO` is passed on the command line (not baked into the
project) so the committed project stays device-ready.

## Install on a physical iPhone (developer mode)

1. **Set a signing team.** Open `FlowiOS.xcodeproj`, select the **Flow**
   target → **Signing & Capabilities** → check **Automatically manage
   signing** → choose your **Team** (your personal Apple ID is fine — add it
   in Xcode ▸ Settings ▸ Accounts if needed).

2. **Make the bundle id unique if required.** The default is `org.flowtoo.ios`.
   Free/personal signing needs a bundle id no one else has registered; if
   Xcode complains, change it (target settings, or `PRODUCT_BUNDLE_IDENTIFIER`
   in `project.yml` → re-`xcodegen generate`) to e.g. `com.<you>.flow`.

3. **Enable Developer Mode on the iPhone** (iOS 16+): plug in the phone, then
   Settings ▸ Privacy & Security ▸ **Developer Mode** ▸ on ▸ restart. (First
   time only.)

4. **Run to the device.** With the iPhone connected and unlocked, pick it as
   the run destination in Xcode and press Run (⌘R). Xcode builds, signs,
   installs, and launches.

5. **Trust the developer cert** (first install with a personal team): on the
   phone, Settings ▸ General ▸ VPN & Device Management ▸ tap your Apple ID ▸
   **Trust**. Then relaunch the app.

CLI alternative once signing is configured (needs `DEVELOPMENT_TEAM`):

```sh
xcodebuild -project FlowiOS.xcodeproj -scheme Flow \
  -destination 'generic/platform=iOS' \
  -allowProvisioningUpdates DEVELOPMENT_TEAM=<YOUR_TEAM_ID> build
```

Notes:
- **Personal (free) signing certs expire after 7 days** — the app stops
  launching until you rebuild/reinstall from Xcode. A paid Apple Developer
  Program membership ($99/yr) gives 1-year certs and TestFlight.
- The phone and the app must reach the server. It defaults to
  `https://app.flowtoo.org` (public), so a device works out of the box. To
  point a device at your Mac's local dev server, use the Mac's LAN IP (not
  `127.0.0.1`) and note the local-HTTP ATS exception only covers
  loopback/`.local` — see Server selection below.

## Server selection

Resolution order (from `Support/Server.swift`, shared with macOS):

1. `FLOW_SERVER_URL` environment variable (dev/QA override)
2. `FlowServerURL` key in Info.plist — set in `project.yml`, **defaults to
   `https://app.flowtoo.org`**
3. Local dev fallback `http://127.0.0.1:8787`

Per-server storage isolation (cache DB, Keychain slot) keeps prod and dev
sessions separate. Cleartext HTTP is allowed only to loopback/`.local` via an
`NSAllowsLocalNetworking` ATS exception; production HTTPS stays enforced.

Registration is web-first on real servers (email-first flow on
app.flowtoo.org, then the `flow://signin` handoff) — the app links out to the
web rather than registering in-app, matching macOS.

## DEBUG QA hooks (compiled out of release)

For driving the simulator without a UI text-input tool. Prefix with
`SIMCTL_CHILD_` when passing through `simctl launch`:

| Env var | Effect |
|---|---|
| `FLOW_DEBUG_EMAIL` / `FLOW_DEBUG_PASSWORD` | auto sign-in once bootstrap resolves to signed-out |
| `FLOW_DEBUG_OPEN_CHANNEL=<name>` | auto-navigate into that channel |
| `FLOW_DEBUG_SEND=<text>` | post one message via the composer's engine path |
| `FLOW_DEBUG_REACT=<emoji>` | toggle that reaction on the newest message |
| `FLOW_DEBUG_EDIT_LAST=<text>` | edit the newest message |
| `FLOW_DEBUG_DELETE_LAST=1` | delete the newest message |
| `FLOW_DEBUG_REPLY_LAST=<text>` | reply in thread to the newest root message |
| `FLOW_DEBUG_OPEN_THREAD_LAST=1` | push the thread screen for the newest threaded message |
| `FLOW_DEBUG_UPLOAD=<path>[,<path>…]` | route host files through the composer upload pipeline |
| `FLOW_DEBUG_UPLOAD_SEND=<text>` | send the uploaded attachments with that body |

Any `FLOW_DEBUG_*` variable also suppresses the badge-permission prompt in
DEBUG builds (a system alert would wedge headless runs — simctl can't tap).

Example against the local dev server + QA fixtures (alice@qa.local /
qa-password-1, workspace "QA Lab"):

```sh
SIMCTL_CHILD_FLOW_SERVER_URL=http://127.0.0.1:8787 \
SIMCTL_CHILD_FLOW_DEBUG_EMAIL=alice@qa.local \
SIMCTL_CHILD_FLOW_DEBUG_PASSWORD=qa-password-1 \
SIMCTL_CHILD_FLOW_DEBUG_OPEN_CHANNEL=general \
xcrun simctl launch 'iPhone 17 Pro' org.flowtoo.ios
```

## Known limitations

- No push notifications yet (the one remaining parity gap — see the
  **Parity** section of `CHANGELOG.md`). Design for closing it:
  `docs/design/PUSH_APNS.md`.
- Composer input is plain text + @-mention autocomplete (ruled scope) — the
  live-styled fence/code composer was not ported; rendering is full parity.
- No CI for the iOS target yet; builds are local.
- No app icon / launch-screen art (uses defaults).
