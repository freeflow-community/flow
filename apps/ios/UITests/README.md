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

   **If `TEST_RUNNER_…` is ignored** (seen on Xcode 17.4 / iOS 26.5 — the
   runner keeps the in-code 8787 default and every test fails with "never
   signed in"), inject the variable into the `.xctestrun` instead. This always
   works, because it is the file the runner is actually launched from:

   ```sh
   xcodebuild build-for-testing -project FlowiOS.xcodeproj -scheme Flow \
     -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
     -derivedDataPath .build CODE_SIGNING_ALLOWED=NO
   R=.build/Build/Products/Flow_iphonesimulator*.xctestrun
   /usr/libexec/PlistBuddy -c \
     "Add :FlowUITests:EnvironmentVariables:FLOW_TEST_SERVER_URL string http://127.0.0.1:8791" $R
   xcodebuild test-without-building -xctestrun $R \
     -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
   ```

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
- `ArtifactsTests` — #157: the header Docs button, its count badge, the
  dropdown, and the viewer for each artifact kind. Needs the extra fixtures:

  ```sh
  node packages/server/scripts/qa-seed-artifacts.mjs   # after qa-seed.mjs
  ```

  That creates `#docs157` with exactly four artifacts (HTML, text, image,
  link) — the badge assertion is that number, so pin nothing else in there.
  Override the channel with `FLOW_TEST_ARTIFACT_CHANNEL`. These tests also
  attach the screenshots the PR uses; pull them out of the result bundle with
  `xcrun xcresulttool export attachments --path <run>.xcresult --output-path <dir>`.

- `HeaderTopicAndZoomTests` — #202: the channel topic under the channel name,
  and pinch/double-tap/pan zoom in both full-screen image viewers. Needs two
  extra channels in the QA Lab workspace, which no seed script creates yet:
  `topic202` (a topic long enough to truncate, one image message, the same
  image and a PDF pinned as artifacts) and `notopic202` (no topic). Override
  the names with `FLOW_TEST_TOPIC_CHANNEL` / `FLOW_TEST_NO_TOPIC_CHANNEL`. Use
  a detailed image, not a flat colour — a zoomed swatch looks identical to an
  unzoomed one, and the screenshots are the evidence. Attaches them too. The
  two PDF cases (artifact pane and chat attachment, neither of which #202
  changed) run against whatever `FLOW_TEST_PDF_ARTIFACT` names, pinned as an
  artifact *and* posted as a message attachment; they skip if it is absent.

- `ThreadNavTests` — thread navigation stays healthy: open a thread, come back
  (Back button, edge swipe, cancelled half-swipe, rapid open/close cycles),
  then reopen a thread and switch channels. Fixtures come from
  `node packages/server/scripts/qa-seed-nav.mjs` (channels `nav205a` /
  `nav205b`; override with `FLOW_TEST_THREAD_CHANNEL` /
  `FLOW_TEST_SECOND_CHANNEL`). Note XCUITest waits for app quiescence before
  each tap, so it cannot tap mid-animation — the push-during-pop race these
  tests guard against was only reproducible on a device with a slow link.

- `ScrollBounceTests` — a short back-pull through history stays where the
  finger left it instead of snapping back to the newest message. Fixture is
  `qa-seed-nav.mjs`'s `scroll209` channel (40 messages; override with
  `FLOW_TEST_SCROLL_CHANNEL`). Same caveat: the synthesized slow drag has no
  deceleration frames, so the release-time snap the fix removes was only
  fully reproducible with a real flick on a device — the test pins the fixed
  behaviour rather than discriminating the old code.

- `MemberProfileCardTests` — #223, the member profile card: both tap targets
  (avatar and sender name), the same from a thread, a profile with a website
  and a bio, one with neither, and the website handing off to Safari. Fixtures
  come from `node packages/server/scripts/qa-seed-profiles.mjs` after
  `qa-seed.mjs` — channel `profiles223`, Bob with both fields set and Alice
  with neither (override the channel with `FLOW_TEST_PROFILE_CHANNEL`).
  Attaches the screenshots. Note SwiftUI's `Link` is a **button** to
  XCUITest, not a link.

- `NewDmTests` — #257, starting a DM: the sidebar "+", search, a 1:1, the
  same person twice (which must reuse the conversation, not duplicate it), a
  group DM, and the profile card's Message button. Fixtures are plain
  `qa-seed.mjs` — Bob and Scott (override with `FLOW_TEST_DM_PERSON` /
  `FLOW_TEST_DM_PERSON_2`). Two things these tests have to work around and any
  new sidebar test will too: the Direct Messages section sits below the fold
  once a workspace has many channels, and **XCUITest does not scroll to an
  element for you**; and both the sidebar and the picker are lazy, so an
  off-screen row does not merely fail to be hittable — it does not exist to
  query. Hence `openDrawerAtDms` and picking people by searching first.

- `NewChannelFirstVisitTests` — #269: a channel that appears while the app is
  running must show its transcript on the *first* visit. Needs only
  `qa-seed.mjs`: the test itself plays the agent over REST (Bob creates a
  channel, invites Alice, posts), because the channel has to arrive into an
  already-running app. Three variants — app in the foreground, backgrounded,
  and not running. Note the first tap after a resume can be swallowed, hence
  the drawer helper that confirms the backdrop and retries.

These suites read `FLOW_TEST_*` overrides from the *runner's* environment, so
they need the `TEST_RUNNER_` prefix **exported into xcodebuild's environment** —
passing them as trailing `xcodebuild` arguments looks right and silently does
nothing (the app just talks to the default server):

```sh
export TEST_RUNNER_FLOW_TEST_SERVER_URL=http://127.0.0.1:8789
xcodebuild test …
```
