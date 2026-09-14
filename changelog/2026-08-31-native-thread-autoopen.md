# macOS and iOS auto-open the thread holding a channel's oldest unread

- `[macos]` `[ios]` Tapping a channel whose oldest unread is a thread reply now
  opens that thread on the reply, instead of a main timeline showing nothing
  new (#327 parity, closes the gap in the CHANGELOG Parity ledger).
- `[macos]` `[ios]` The channel cache keeps the server's
  `oldestUnreadThreadReply` (migration v22) and clears it with the
  notifications it is derived from, so a just-read channel never jumps.

## Feature

- **A thread that's waiting on you opens itself.** On Mac and iPhone, tapping a
  channel whose only unread messages are replies takes you straight into that
  thread, at the first reply you haven't read — no more hunting for which
  thread the badge meant. Channels with unread messages on the main timeline
  open exactly as before.
