# Quote blocks hug their text on macOS and iOS

- `[macos]` `[ios]` Draw a blockquote's accent bar as a leading overlay on the
  quoted text instead of an `HStack` sibling. A `Shape` has no ideal height, so
  as a sibling it absorbed the space the prose needed — the bar ran on below
  the quote and the surrounding paragraphs truncated (#195).

## Feature

- **Quoted text no longer leaves a block of empty space.** On the Mac and iPhone
  apps a `>` quote inside a longer message now takes only the room it needs, the
  purple bar stops at the last quoted line, and the paragraphs around it are no
  longer cut short.
