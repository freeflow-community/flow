# Flow iOS

Native iOS client (SwiftUI, iOS 17+). Shares the macOS app's platform-agnostic
layers — data model, REST/WS clients, GRDB cache, `SyncEngine`, `AppState`, and
the cross-platform `Support/` helpers — and adds iOS-native views + a UIKit
image loader. Only the touch UI is new; the whole data/sync stack is reused.

**Status: working vertical slice.** Sign-in → workspace switch → channel &
DM list → message list (avatars, @-mentions, timestamps, author grouping) →
send a message. Threads, reactions, files, typing indicators, and rich
markdown are not yet ported (later increments).

## Build & run

The Xcode project is generated from `project.yml` by
[xcodegen](https://github.com/yonik/xcodegen) — it is gitignored, so generate
it first:

```sh
brew install xcodegen        # once
cd apps/ios
xcodegen generate            # produces FlowiOS.xcodeproj
open FlowiOS.xcodeproj        # then Run (Cmd-R) on a simulator or device
```

Command-line build + run in a simulator:

```sh
xcodebuild -project FlowiOS.xcodeproj -scheme Flow \
  -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -derivedDataPath .build CODE_SIGNING_ALLOWED=NO build
APP=$(find .build/Build/Products -name Flow.app -path '*iphonesimulator*' | head -1)
xcrun simctl boot 'iPhone 17 Pro' 2>/dev/null; xcrun simctl install 'iPhone 17 Pro' "$APP"
xcrun simctl launch 'iPhone 17 Pro' org.flowtoo.ios
```

## Server selection

Same mechanism as macOS (`Support/Server.swift`): `FLOW_SERVER_URL` env →
`FlowServerURL` in Info.plist → local-dev fallback. **Packaged builds default to
`https://app.flowtoo.org`** (set in `project.yml`). Per-server storage isolation
keeps prod and dev sessions/caches separate.

Register on the web (email-first flow) then sign in here — in-app registration
is intentionally web-only against real servers, matching macOS.

## Regenerating after adding files

`project.yml` globs `Sources/` and the reused macOS paths, so **after adding a
new Swift file, re-run `xcodegen generate`** before building.

## DEBUG QA hooks (compiled out of release)

Drive the simulator without a UI text-input tool via environment variables
(prefix with `SIMCTL_CHILD_` when passing through `simctl launch`):

| Var | Effect |
|---|---|
| `FLOW_DEBUG_EMAIL` / `FLOW_DEBUG_PASSWORD` | auto sign-in once bootstrap resolves |
| `FLOW_DEBUG_OPEN_CHANNEL=<name>` | auto-push that channel |
| `FLOW_DEBUG_SEND=<text>` | post one message via the composer's engine path |

Example (against the local dev server + QA fixtures):

```sh
SIMCTL_CHILD_FLOW_SERVER_URL=http://127.0.0.1:8787 \
SIMCTL_CHILD_FLOW_DEBUG_EMAIL=alice@qa.local \
SIMCTL_CHILD_FLOW_DEBUG_PASSWORD=qa-password-1 \
SIMCTL_CHILD_FLOW_DEBUG_OPEN_CHANNEL=general \
xcrun simctl launch 'iPhone 17 Pro' org.flowtoo.ios
```

(Local HTTP is allowed via an `NSAllowsLocalNetworking` ATS exception; prod
stays HTTPS-enforced.)
