# Mini apps 3b/4 — macOS: mint before opening an app in the panel

- `[macos]` Opening a link artifact with `isApp` mints a 5-minute identity
  token before anything loads, then loads `url + ?flow_token=…` in the panel's
  web view; reloading re-mints. Unlike web, the app renders *inside* Flow — a
  top-level `WKWebView` makes the guard's cookie first-party, so the
  third-party-cookie block that forces web into a new tab doesn't apply.
- `[macos]` The minted url is never broadcast to co-browse: a token belongs to
  one viewer and is burned on first use, so the shared artifact url stays
  clean. Needed because a rejected token 401s *without* redirecting, leaving
  the tokened url committed in the web view.
- `[macos]` A failed mint (no longer a member, artifact gone) shows the error
  in the pane with Try again, and never asks the app's tunnel for a page. An
  `APP` badge marks the artifact as an app in the URL bar.
- `[macos]` Open-in-browser mints a fresh token too — the panel's is spent.

## Feature

- **Apps your team hosts open right inside Flow on the Mac, already signed
  in.** Click an app pinned in a channel and it loads in the panel with no
  login and no shared password; only channel members can get in.
