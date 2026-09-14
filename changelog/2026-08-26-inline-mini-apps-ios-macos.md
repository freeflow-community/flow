# Mini apps open inline on iOS, and never co-browse on either native client

- `[ios]` Tapping an app artifact now mints an identity token and loads the
  tokened url top-level in the co-browser web view, replacing #373's hand-off
  card. The safari button keeps the hand-off as an explicit secondary action
  (fresh mint). A failed mint shows the error pane with a retry and puts no
  request on the app's tunnel.
- `[ios]` `[macos]` An `isApp` artifact never broadcasts navigation: neither the
  guard's 302 to the clean url nor a member's clicks inside the app can re-point
  the shared artifact for the channel. The rule lives in the shared `MiniApp`,
  gating both the navigation delegate and the address bar.
- `[ios]` New `FlowUnitTests` target compiles the macOS suite's `MiniAppTests` /
  `AppTokenTests` files against the same shared sources, so a rule both clients
  depend on cannot pass on one and rot on the other.
- `[ios]` `[macos]` The mint-error pane's retry button was unreachable to
  VoiceOver and to UI tests — the container's accessibility identifier swallowed
  it. Fixed on both.

## Feature

- **Apps open right where you are on iPhone and Mac.** Tapping an app artifact
  signs you in and shows it in the artifact view, instead of throwing you out to
  a browser. There's still an "Open in Browser" button when you want the full
  screen.
- **Opening an app no longer moves the page for everyone else.** Browsing around
  inside an app is yours alone — it can't re-point the shared artifact the rest
  of the channel is looking at.
