# Hand cursor over links in table cells and the channel topic

- `[macos]` `.linkCursor` now covers the two link-bearing surfaces that never
  had it: markdown table cells and the header topic (#276).
- `[macos]` Link rects are measured at the size the text is drawn at, not
  always body size — a heading's link rect was ~30% too narrow, so the hand
  stopped partway across it.

## Feature

- **The pointer turns into a hand over every link.** Links in a table and in a
  channel's topic now show the hand cursor like links in a message do.
