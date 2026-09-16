# macOS: Connect Slack no longer crashes the app

- [macos] [ios] The `ASWebAuthenticationSession` completion handlers ran as main-actor closures although AuthenticationServices calls them on a background queue; Swift's executor check killed the app (EXC_BREAKPOINT in `dispatch_assert_queue`). Built off the actor now — Connect Slack, Flow browser sign-in (macOS) and the iOS in-app sign-in sheet.
- [qa] `webAuthCallbackIsDeliveredOffTheMainActor`.

## Feature

- **Connect Slack works on macOS.** Signing in to Slack from the Mac app no longer quits the app.
