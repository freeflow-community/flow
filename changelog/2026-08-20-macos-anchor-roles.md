# macOS: late image loads no longer yank the reading position

- `[macos]` The bottom scroll anchor is scoped to initial placement on
  macOS 15+ (as iOS did in #159): its size-change role re-anchored to the
  bottom whenever an attachment or link preview finished loading, which
  visibly undid the scroll-position restore moments after returning to any
  channel with media.
- `[macos]` Landing scrolls gained the iOS-style settle passes, since the
  anchor no longer papers over a landing issued before rows have heights.
