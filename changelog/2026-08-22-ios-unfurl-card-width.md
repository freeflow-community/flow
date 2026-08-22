# iOS link cards fit the phone

- `[ios]` A `large_image` link preview drew its picture at a fixed 360 pt — a
  desktop number — so the row asked for 455 pt on a 393 pt phone and dragged
  the whole transcript, header pill included, off the screen. The picture now
  takes its width from the window. Video cards made this the common case
  (#302); `summary_large_image` pages had it before that.
