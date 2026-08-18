# A newly created channel shows its messages on the first visit

- `[macos]` `[ios]` A channel screen now guarantees its own history page
  (`SyncEngine.ensureHistory`) instead of relying on the *selection* having
  changed — the path that left a first visit blank until you switched away and
  back (#269).
- `[macos]` `[ios]` The history fetch retries 3× before falling back to the
  cache, and a channel whose fetch failed isn't marked loaded — one dropped
  request no longer decides a transcript is empty.
- `[qa]` New `NewChannelFirstVisitTests` — an agent creates a channel, invites
  the user and posts, in the foreground / backgrounded / not running.

## Feature

- **A channel someone just created shows its messages the moment you open it.**
  No more blank chat that only fills in after you switch away and come back.
