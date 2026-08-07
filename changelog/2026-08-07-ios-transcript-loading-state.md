# iOS: the chat no longer blanks out

- `[ios]` The transcript keeps its scroll position by anchoring to a message
  identity instead of an offset computed from a `LazyVStack`'s estimated row
  heights (#191). With screens-tall agent replies those estimates were wrong
  enough to land the viewport past the end of the laid-out rows, so focusing the
  composer — or just opening the channel — showed an empty chat.
- `[ios]` The transcript shows a loading state instead of bare background while
  a channel's history page is in flight, and keeps already-rendered messages
  when the observation restarts.
- `[macos]` `[ios]` `SyncEngine` publishes `AppState.loadingHistory` for the
  channel it is fetching; only iOS renders it so far (see CHANGELOG Parity).

## Feature

- **The chat no longer goes blank on iPhone.** Tapping into the message box, or
  opening a long conversation, used to empty the screen until you tapped away
  again. And while a conversation is still arriving you now see "Loading
  conversation…" rather than nothing at all.
