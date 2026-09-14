# YouTube embeds play on macOS and iOS (error 153)

- `[macos]` `[ios]` The player sheet now loads a minimal local wrapper page
  holding the embed in an `<iframe>`, instead of navigating the web view at the
  embed URL. A top-level load carries no `Referer` and no embedding origin,
  which YouTube refuses with "Error 153"; web was unaffected because its iframe
  already sits in a page (#318, follow-up to #302).
- `[macos]` `[ios]` The wrapper is built here from the server's `playerUrl`,
  HTML-escaped — no provider markup reaches a client, and nothing loads until
  the viewer taps play.

## Feature

- **YouTube videos actually play in the Mac and iPhone apps.** Pressing play on
  a YouTube link opens the player and plays it — on iPhone in place, without
  taking over the screen — instead of showing "Error 153".
