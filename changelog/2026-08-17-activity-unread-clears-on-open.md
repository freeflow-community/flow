# Opening a channel clears its Activity unreads immediately

- `[macos]` `[ios]` Opening a channel now zeroes its Activity badge locally
  before the history page is even requested, instead of waiting out four
  sequential round trips; the server's `notification.read` still reconciles.
- `[macos]` `[ios]` An empty history page no longer skips the read call — the
  cursor falls back to the newest cached message, so the server is told even
  when the page comes back with nothing (it used to look read on that device
  only).

## Feature

- **Unread badges clear the moment you open a channel.** The Activity count
  and the channel's badge drop as soon as you tap in, rather than a beat or
  two later on a slow connection.
