# New messages no longer flash the default avatar

- `[web]` `[macos]` `[ios]` A sent message's avatar always painted the
  placeholder (initials chip / grey pulse) for one frame, even on a cache
  hit — the image loaders had no synchronous cache read, only an async one.
  `ImageLoader.cachedImage` (macOS/iOS) and a resolved-URL side cache next to
  `blobCache` (web) now seed the image view's initial state directly.
- `[web]` `[macos]` `[ios]` The optimistic message row also remounted (and
  re-flashed) when the server echo reconciled it, because the row list keyed
  on message id — which changes between the optimistic and server rows.
  Message rows now key on `clientMsgId`, which is stable across the
  reconcile.
- `[web]` `[macos]` `[ios]` The signed-in user's own avatar is now warmed
  into the image cache at startup, so the very first send of a session gets
  the same fix.

## Feature

- **Sending a message no longer shows a flash of the default avatar before
  your photo appears.**
