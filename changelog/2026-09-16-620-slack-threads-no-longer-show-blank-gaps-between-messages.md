# Slack threads no longer show blank gaps between messages (macOS, iOS)

- `[macos]` `[ios]` Transcript rows fall back to the message id when `clientMsgId` is empty (Slack app/bot/API posts), as web already does; duplicate row identities left viewport-high gaps and undrawn replies (#620).
- `[macos]` `[ios]` A key-less server message no longer "reconciles" against — and deletes — every other key-less message in its channel.

## Feature

- **Slack threads read straight through.** Threads with app or bot replies now show every message back to back, with no screens of empty space between them.
