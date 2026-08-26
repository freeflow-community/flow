# Hand cursor over links, in every surface that renders one

- `[macos]` The hand cursor over links never actually appeared on message
  paragraphs or headings (#276): the cursor overlay declined all hit testing,
  and AppKit uses that same hit test to decide whose cursor rects apply, so
  selectable text kept the I-beam. The overlay is now frontmost over the link
  rects only — and therefore owns the click, which it opens itself.
- `[macos]` `.linkCursor` also covers the two surfaces that never had it at
  all: markdown table cells and the header topic.
- `[macos]` Link rects are measured at the size the text is drawn at, not
  always body size — a heading's link rect was ~30% too narrow.

## Feature

- **The pointer turns into a hand over every link.** Links in ordinary
  messages, headings, tables and a channel's topic all show the hand cursor,
  and clicking one opens it.
