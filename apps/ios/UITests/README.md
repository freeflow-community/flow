# iOS UI tests

XCUITest target for the iOS app. Unlike the macOS QA harness (which drives a
real window through the accessibility tree and therefore needs an idle
desktop), these taps happen *inside* the simulator — they don't touch the
operator's screen, so they're safe to run any time.

## Prerequisites

1. **Dev server + fixtures.** Backend at `http://127.0.0.1:8787`
   (`docker compose -f packages/infra/docker-compose.yml up -d`, then
   `pnpm dev` in `packages/server`), seeded with:

   ```sh
   node packages/server/scripts/qa-seed.mjs
   ```

   The tests sign in as `alice@qa.local` / `qa-password-1` via the
   `FLOW_DEBUG_EMAIL` / `FLOW_DEBUG_PASSWORD` launch hooks and open `#general`
   via `FLOW_DEBUG_OPEN_CHANNEL` (all DEBUG-only, compiled out of release).
   `FLOW_SERVER_URL` points the app at the local server.

   Both defaults are overridable, because neither holds on every machine — port
   8787 is often taken, and old QA-Lab `#general` rows are encrypted with a dev
   key a fresh server doesn't hold (message fetch 500s). Pass them through to
   the test runner with Xcode's `TEST_RUNNER_` prefix:

   ```sh
   TEST_RUNNER_FLOW_TEST_SERVER_URL=http://127.0.0.1:8788 \
   TEST_RUNNER_FLOW_TEST_CHANNEL=kbd139 \
   xcodebuild test …
   ```

   The scroll test wants a transcript long enough to actually scroll — seed a
   fresh channel with a few dozen messages rather than reusing `#general`.

2. **Software keyboard on.** Keyboard tests need the on-screen keyboard, which
   the simulator hides while a hardware keyboard is connected:

   ```sh
   defaults write com.apple.iphonesimulator ConnectHardwareKeyboard -bool false
   ```

3. **An installed simulator runtime** (`xcodebuild -downloadPlatform iOS`).

## Run

```sh
cd apps/ios
xcodegen generate
xcodebuild test -project FlowiOS.xcodeproj -scheme Flow \
  -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -derivedDataPath .build CODE_SIGNING_ALLOWED=NO
```

If the runner fails to launch with `Busy ("Application failed preflight
checks")`, the simulator is wedged from a previous run:
`xcrun simctl shutdown all && xcrun simctl erase <device-id>`.

## Tests

- `KeyboardDismissTests` — #69/#139: the keyboard goes down when the drawer
  opens, and on any tap or scroll of the chat area. Verified red before each
  fix, green after.
