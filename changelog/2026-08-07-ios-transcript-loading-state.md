# iOS: the chat no longer blanks while history loads

- `[ios]` The transcript shows a loading state instead of bare background while
  a channel's history page is in flight, and keeps already-rendered messages
  when the observation restarts (#191). On a slow link the blank window read as
  a lost conversation.
- `[macos]` `[ios]` `SyncEngine` publishes `AppState.loadingHistory` for the
  channel it is fetching; only iOS renders it so far (see CHANGELOG Parity).

## Feature

- **Slow connections no longer look like lost conversations on iPhone.** While
  a channel's history is still arriving you now see "Loading conversation…"
  rather than an empty screen, and messages already on screen stay put.
