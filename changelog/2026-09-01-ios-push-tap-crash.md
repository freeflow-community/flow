# iOS: tapping a push notification no longer crashes the app

- `[ios]` Fixed the crash on every notification tap (#458). Both
  `UNUserNotificationCenterDelegate` callbacks now use their completion-handler
  form, so the handler runs on the main actor — the `async` bridge called it on
  a cooperative-pool thread and UIKit aborted with "Call must be made on main
  thread". The handler is also called exactly once on every path.
- `[ios]` A cold-launch tap now actually opens the target channel. The tap is
  held until the app is signed in; replaying it earlier lost the selection,
  because bootstrap passes through `.signedOut` and that clears the window.
- `[ios]` A push whose routing keys are missing, empty or the wrong type opens
  the app where it was instead of navigating nowhere.
- `[qa]` Regression coverage for malformed payloads and the route-when-ready
  rule in `PushPayloadTests` (compiled into both the macOS and iOS suites).

## Feature

- **Tapping a Flow notification opens the conversation instead of crashing.**
  It works whether the app was closed, in the background or already on screen,
  and a notification the app can't make sense of just opens Flow rather than
  quitting it.
