# Android client proposal: route + suggested phasing

- New `docs/design/ANDROID.md` (PROPOSAL): proposes shipping Android as the
  web client in a Capacitor shell — route comparison, same-origin decoupling
  prework (apiBase + CORS), suggested phasing to a Play listing, FCM push as
  a driver behind the existing `PushSender` seam, and the open operator
  rulings (Play UGC compliance, huddles and mini apps in v1). Revised
  2026-09-07 against `main`: records the route ruling from #228, and adds the
  Android implications of voice huddles (mic permission, foreground service,
  audio routing) and mini apps. Docs only; nothing built.
