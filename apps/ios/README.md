# Flow iOS

Native iOS client (SwiftUI, iOS 17+). Shares the macOS app's platform-agnostic
layers — data model, REST/WS clients, GRDB cache, `SyncEngine`, `AppState`, and
the cross-platform `Support/` helpers — and adds iOS-native views + a UIKit
image loader. Only the touch UI is new; the whole data/sync stack is reused.

**Status: daily-driver parity (phase 7).** Sign-in → workspace switch →
channel & DM list → messaging with rich markdown, mention pills, reactions,
long-press actions (edit/delete/react/reply), threads (pushed screen),
typing indicators, attachments (render + upload: photo library / Files /
camera, QuickLook previews, lightbox), and an unread app-icon badge. The one
remaining gap is push notifications (deferred; see CHANGELOG Parity).

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

## Upload to TestFlight (manual, Xcode GUI)

There's no release script yet — do it from Xcode for now. Prerequisites, all
one-time: an **Apple Developer Program** membership on the team that owns
`org.flowtoo.app`; an **app record** for that bundle id in App Store Connect
(Apps → +); and your **Team ID** (Xcode → Settings → Accounts, or
developer.apple.com → Membership). You do *not* need to create a distribution
certificate by hand — automatic signing provisions it.

1. Generate and open the project:
   ```sh
   cd apps/ios
   xcodegen generate
   open FlowiOS.xcodeproj
   ```
2. **Bump the build number first.** App Store Connect rejects a re-used build
   number for the same version. Version + build come from `project.yml`
   (`MARKETING_VERSION: 0.1.1`, `CURRENT_PROJECT_VERSION: 1`), which the
   generated `Info.plist` references as `$(MARKETING_VERSION)` /
   `$(CURRENT_PROJECT_VERSION)` — so edit them **in `project.yml`, not the Xcode
   GUI** (GUI edits are wiped on the next `xcodegen generate`, and a literal in
   the plist would silently pin every archive to its value). Increment
   `CURRENT_PROJECT_VERSION` and re-run `xcodegen generate` for every upload.
3. Signing is already wired: `project.yml` sets `DEVELOPMENT_TEAM` (BizTrip AI
   Inc., `76NSMTH84G`) with automatic signing, so the team survives
   `xcodegen generate`. Just confirm **Signing & Capabilities** shows that team
   with no errors (you must be signed into an Xcode account that belongs to it).
4. Set the run destination to **Any iOS Device (arm64)** — not a simulator;
   archiving needs a device SDK.
5. **Product ▸ Archive.** When it finishes, the Organizer opens.
6. Select the archive → **Distribute App ▸ App Store Connect ▸ Upload**, keep
   the defaults (Xcode signs with an automatically-provisioned distribution
   cert/profile), and finish. The build appears in App Store Connect →
   TestFlight after processing (a few minutes), then assign it to testers.

Note: builds default to the production server `https://app.flowtoo.org` (see
Server selection below), which is what you want for TestFlight.

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

Additional hooks (react / edit / delete / thread-reply / open-thread /
upload) are listed in `docs/design/IOS.md`.

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
