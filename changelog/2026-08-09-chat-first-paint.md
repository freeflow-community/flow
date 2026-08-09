# No more blank transcript on channel switch

- `[macos]` `[ios]` `DBObserved` fetches its first value synchronously, so a
  channel switch paints cached history in the first frame instead of a blank
  list while the observation spins up.
- `[macos]` Ported the iOS #191 loading states: "Loading conversation…" /
  "Loading earlier messages…" while the first page is in flight, "No messages
  yet" for a truly empty channel.

## Feature

- **Switching channels no longer flashes a blank screen.** Cached messages
  appear instantly, and the Mac app now says when a conversation's history is
  still loading instead of showing an empty pane.
