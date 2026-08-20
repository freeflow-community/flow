# macOS: "I was at the top" is remembered too

- `[macos]` Parking at the very top of a channel is now recorded (the
  recorder's probe line was covered by the Load-earlier control there, so
  the final position was never captured) — the #message-search report.
- `[macos]` A remembered row that slid outside the message window restores
  to the window's top instead of falling to the bottom.
- `[macos]` Scroll-memory decisions (record/clear/restore) log at info level
  in release builds — ids only — so field reports are diagnosable from
  `log show`.
