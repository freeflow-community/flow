# iOS: channel topic in the header, and pinch-to-zoom in the image viewers

- `[ios]` Show the channel topic under the channel name, muted and truncated to
  one line, live with the channel row. macOS has had it since #194.
- `[ios]` Pinch, double-tap and pan to zoom the full-screen image viewers — the
  chat lightbox and the image artifact pane — through one shared
  `UIScrollView`-backed helper. Neither could zoom before.
- `[ios]` The topic sits just under the navigation bar, not inside it: a
  principal toolbar item does not survive this screen's shared nav bar and
  leaves the header blank.
- `[qa]` `HeaderTopicAndZoomTests` drives both, pinch included, and attaches the
  screenshots.

## Feature

- **The channel topic now shows on your phone.** It sits under the channel name
  and updates as soon as anyone changes it, on any device.
- **Full-screen pictures zoom.** Pinch or double-tap a picture you opened from a
  conversation or from Docs, then drag to look around.
