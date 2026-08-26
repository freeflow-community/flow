# iOS reopens the channel you were last reading

- `[ios]` Cold launch and resume open the last-viewed channel instead of the
  "Select a channel" screen (#242). Falls back to the landing screen when the
  stored channel is gone, archived, or you've left it.
- `[ios]` `[macos]` The channel id is stored in `UserDefaults` alongside the
  existing active-workspace key, per profile and per server; only iOS restores
  it for now.
- `[qa]` `LastChannelRestoreTests` covers the cold-relaunch case, the unusable
  stored id, and an explicit launch destination outranking the restore.

## Feature

- **The iOS app picks up where you left off.** Reopen Flow on your phone and
  you land back in the channel you were reading, not on an empty screen.
