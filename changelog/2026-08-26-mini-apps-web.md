# Mini apps 3a/4 — web: mint before opening an app in the mini-browser

- `[web]` Opening a link artifact with `isApp` mints a 5-minute identity token
  (`POST /v1/artifacts/:id/app-token`) before anything loads, then frames
  `url + ?flow_token=…`; reloading re-mints. The shared, co-browsed url stays
  token-free — each viewer appends their own at load time.
- `[web]` Safari (and every browser on iOS) blocks the guard's third-party
  cookie outright, so the app is offered as a one-click **Open app in new tab**
  instead of a frame that could only render the guard's 401. Measured, not
  assumed — see the PR; closing this properly needs a guard-side change.
- `[web]` A failed mint (no longer a member, artifact gone) shows the error in
  the pane with Try again, and never asks the app's tunnel for a page.

## Feature

- **Apps your team hosts now open already signed in.** Click an app pinned in a
  channel and it just works — no login, no shared password — and only channel
  members can get in. In Safari it opens in a new tab rather than inside Flow.
