# iOS: bundle the release notes instead of fetching them

- `[ios]` The "What's new" screen now reads FEATURES.md from the app bundle, so
  it shows the notes of the installed build and needs no network. A new
  "Bundle FEATURES.md" build phase generates and copies the file, the same two
  steps `make-app.sh` runs for macOS.
- `[ios]` The version row shows the build number too (`Version 2.0 (21)`) — one
  marketing version covers many TestFlight builds.
- `[macos]` `FeatureNotes.fetch` and its `FLOW_DEBUG_FEATURES_URL` hook are
  gone; nothing fetches the notes now.

## Feature

- **The release notes match the app you are running.** On iPhone, What's new no
  longer lists features from a newer build than the one installed, and it opens
  with no network.
