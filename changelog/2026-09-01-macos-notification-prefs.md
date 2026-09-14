# macOS notification preferences, and a sound pref the Mac actually obeys

- `[macos]` Notifications section in the My Profile sheet: the same seven
  toggles web and iOS carry (DMs, mentions, group mentions, thread replies,
  reactions, channel invites, play a sound). Each flip PATCHes only the key
  that moved and reverts on failure; a flip made on another client lands in the
  open sheet. Closes the last notification-prefs parity gap.
- `[macos]` The `sound` pref now reaches the banner — it was set to `.default`
  unconditionally, so turning sound off on web or the phone still chimed on the
  Mac. Web-only `persistentBanners` is deliberately not offered here:
  banner-vs-alert is an OS setting no app can override.
- `[macos]` The profile sheet's fields scroll, since the new section pushed it
  past a laptop screen.

## Feature

- **Notification settings on the Mac.** Choose which kinds of message alert you
  — direct messages, mentions, thread replies and the rest — and whether alerts
  make a sound, right in My Profile. Your choices follow you to every device.
- **Turning the sound off on the Mac now works.** Alerts still appear; they
  just stay quiet.
