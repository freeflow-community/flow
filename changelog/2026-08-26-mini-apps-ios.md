# Mini apps 3c/4 — iOS: mint, then hand the app to Safari

- `[ios]` A link artifact with `isApp` no longer opens in the co-browsing
  webview. It shows a hand-off card whose button mints a 5-minute identity
  token (`POST /v1/artifacts/:id/app-token`) and opens `url + ?flow_token=…`
  in the system browser, where the app loads already signed in. The toolbar's
  Safari button mints the same way; plain link artifacts are untouched.
- `[ios]` A failed mint (no longer a member, artifact gone, unparseable url)
  shows the standard error and opens nothing — the app's origin is never asked
  for a page its guard would refuse.
- `[ios]` `Artifact.isApp`, `SyncEngine.mintAppToken`, and a `withAppToken`
  url join land in the layers macOS shares, with unit tests; macOS (#372) is
  the remaining surface.

## Feature

- **On iPhone, apps your team hosts open already signed in.** Tap an app pinned
  in a channel and it opens in Safari with you already logged in — no password
  to share, and only channel members can get in.
