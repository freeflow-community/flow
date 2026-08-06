# macOS message text invisible in Dark Mode

- `[macos]` Fix message body text rendering white-on-white in Dark Mode. The
  body `Text` was the only element in its row with no `.foregroundStyle`, so
  it inherited SwiftUI's adaptive `.primary` color while the row's background
  is a fixed light hex token — pinned it to `MC.ink` like its siblings.
  VERSION → 2.2.20.

## Feature

- **Message text is now readable in Dark Mode.** Message text used to render
  invisibly (white on a light background) whenever your Mac was set to Dark
  Mode — it's fixed.
