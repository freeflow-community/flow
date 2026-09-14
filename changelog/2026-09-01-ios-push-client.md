# APNs 5/6: the iOS client — permission, registration, foreground rules, tap routing

- `[ios]` `aps-environment` entitlement, driven by a per-configuration
  `APS_ENVIRONMENT` build setting: Debug builds talk to the APNs sandbox,
  Release (TestFlight *and* the App Store) to production.
- `[ios]` Permission widened from `[.badge]` to `[.alert, .sound, .badge]`; the
  `FLOW_DEBUG_*` bail-out now skips only the prompt, so headless QA still never
  meets a system alert.
- `[ios]` New `PushDelegate`: hex-encodes the APNs token and POSTs
  `/v1/me/devices` on every cold start (tokens rotate silently on reinstall and
  restore-from-backup), applies the badge an alert or badge-sync push carries,
  and routes a tap to workspace → channel → message before marking that
  notification row read. A token or tap that beats the UI is replayed once it
  exists, the way the macOS banner delegate already does.
- `[ios]` Foreground rule in the shared, tested `PushPayload.shouldPresentBanner`:
  suppressed for the channel on screen, bannered otherwise. iOS differs from
  macOS deliberately — a thread on the phone *covers* the transcript, so an open
  thread suppresses only its own replies.
- `[ios]` Sign-out deletes the device row **before** `/v1/auth/logout` revokes
  the session — after it, the request 401s, the row leaks to the phone's next
  owner, and the 401 also ends a deliberate sign-out on "Your session expired".
  Delivered pushes are cleared at the same moment.
- `[ios]` `remote-notification` background mode, without which iOS never
  delivers the silent badge-sync push.
- `[qa]` 11 tests over the payload contract and the foreground rule, compiled
  into both the macOS and iOS suites; verified on a simulator with `xcrun
  simctl push` using payload files the dev `PushSender` wrote — banner shown,
  banner suppressed, badge set and cleared, tap routed, device row deleted on
  sign-out.

## Feature

- **Your phone tells you when someone needs you.** Mentions, DMs and thread
  replies now arrive as notifications on iOS even when Flow isn't open, with
  the app-icon badge showing how many are waiting. Tapping one opens straight
  to the message.
- **No banner for the conversation you're already reading**, and reading a
  mention on your laptop clears the badge on your phone.
