# Thread replies stop spinning, and threads scroll to the right place again

- `[macos]` `[ios]` Thread fetch pages to the tail (`after` cursor) instead of
  dropping `hasMore`: past 100 replies the server twin of a fresh reply never
  arrived, so its optimistic row spun on "sending" forever (#328).
- `[macos]` `[ios]` Pending rows older than two minutes flip to `failed` on
  reconnect and on thread open — a send that never landed offers Retry instead
  of an endless spinner, and its server twin still wins if it turns up.
- `[macos]` `[ios]` A send confirmed by the WS echo is no longer flagged
  "Failed to send" when its POST then times out, and the thread's reply count
  stays put.
- `[macos]` `[ios]` Reconnect gap-fill for a channel no longer stops early on a
  recent thread reply: the overlap probe is top-level only, like its siblings.
- `[macos]` Every `scrollTo` names row identity (`clientMsgId`) rather than a
  message id (#329). Correction, from driving it on a Mac afterwards: this was
  not what broke the thread panel — see
  `2026-08-24-thread-panel-anchor-and-row-identity.md`.

## Feature

- **Thread replies stop spinning.** A reply that reached the server now clears
  its "sending" spinner even if your app missed the confirmation, and one that
  genuinely didn't send offers Retry instead of spinning forever.
- **Threads scroll where you're looking again.** On Mac, sending a reply
  scrolls the thread down to it, and jumping to a message from Activity lands
  on that message.
