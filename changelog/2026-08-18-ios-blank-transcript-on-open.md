# iOS: transcript no longer opens blank

- `[ios]` Fix a channel opening to a blank message area until you dragged it
  (#280). The bottom anchor resolves against the `LazyVStack`'s *estimated*
  content height, so rows shorter than the estimate parked the viewport past
  where the content actually ended.
- `[ios]` The re-stick glue now corrects a content **shrink** too, not only
  growth — but only before the reader's first drag, so #159's short-pull bounce
  and #111's back-scroll stay fixed. Plus a short settle pass for when the
  estimate is wrong and the geometry never moves again.
- `[ios]` `[macos]` The decision moved to `TranscriptFollow` in the shared
  `Support/` tree, with unit tests — it had none, and had now been wrong in
  both directions.

## Feature

Opening a channel on iPhone shows the newest messages straight away. Some
channels used to come up blank until you gave the screen a nudge.
