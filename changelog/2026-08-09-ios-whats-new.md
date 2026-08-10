# iOS: "What's new" screen

- `[ios]` New What's new sheet, opened from a version row at the foot of the
  drawer's workspace menu — the release notes and the build tag that web and
  macOS already showed.
- `[ios]` It fetches `FEATURES.md` from the server like the web client rather
  than bundling it: iOS archives straight through `xcodebuild`, with no build
  step to run the generator, and fetched notes don't go stale between releases.
- `[macos]` `FeatureNotes` (load/parse/inline) moved out of `FeaturesView` into
  shared `Support/` so both clients render the notes the same way. No macOS
  behaviour change.
- `[qa]` `FeaturesSheetTests` covers the menu entry, the rendered notes and the
  unreachable-server state; `FLOW_DEBUG_FEATURES_URL` (DEBUG-only) points the
  fetch at a dead server so the failure path is testable.

## Feature

- **See what's new on your iPhone.** The workspace menu now shows the app
  version and opens the release notes, the same ones the Mac and web apps show.
