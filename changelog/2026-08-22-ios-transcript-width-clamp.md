# iOS: the transcript stays as wide as the phone

- `[ios]` A row that cannot fit — a long unbroken URL, most often — reported
  its ideal width anyway, and the screen sized to it: the transcript, the
  composer and the header pill all laid out in a container wider than the
  window. The transcript is now bounded by the window, so such a row wraps
  instead. Follows #306, which fixed one source of this and not the cause.
- `[ios]` A link card's picture also left no room for its remove control, which
  is a sibling of the picture rather than an overlay; the card now publishes
  what its chrome costs and the caller subtracts it.
- `[qa]` `TranscriptWidthTests` posts a URL no phone can fit on one line and
  asserts the transcript is never wider than its window.
