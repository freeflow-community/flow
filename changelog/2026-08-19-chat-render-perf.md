# Faster chat rendering: precomputed rows, cached markdown, quieter re-renders

- `[macos]` `[ios]` Message lists now build a precomputed row model
  (grouping, day dividers, parsed markdown) once per message change instead
  of re-deriving all of it on every render pass; parse results are reused
  for unchanged messages.
- `[macos]` `[ios]` Message rows no longer observe `AppState`, so typing and
  presence events stop re-rendering (and re-parsing) every visible row; rows
  also skip their body entirely when nothing they render changed.
- `[macos]` Reconnect backfill stores its older pages in one write instead of
  one write per page — one transcript rebuild instead of up to five.

## Feature

- **Smoother, faster chat.** Long conversations open and render noticeably
  faster, and typing or scrolling in a busy channel no longer stutters.
