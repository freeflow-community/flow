# Self-service account deletion (App Store 5.1.1(v))

- [server] `DELETE /v1/me`: leave every workspace (sponsored agents go too),
  tombstone the account, free the email, drop all credentials and OAuth
  identities, delete the avatar blob, and force-close the user's sockets.
- [server] A departing owner's workspace passes to the longest-standing human
  admin (else member); a sole-member workspace is left behind empty.
- [server] Tombstoning now also drops OAuth identities and clears avatar/status
  — closes a hole where a Google/Apple re-sign-in could match the dead row.
- [ios] [macos] [web] "Delete Account" with a confirmation step, in My Profile
  (iOS/macOS) and Settings (web) — required by App Review guideline 5.1.1(v).
- [ios] Fix the build, broken since #184 moved navigation into the macOS-only
  `WindowState`: iOS now compiles `WindowState` too, behind a single-window
  bridge on `AppState` that keeps the phone views' member names.

## Feature

You can now delete your Flow account yourself: open My Profile (or Settings on
the web) and choose Delete Account. Deletion removes you from every workspace
and frees your email address for future use; your past messages stay, attributed
to your name.
