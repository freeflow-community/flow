# iOS: a short back-pull on the chat no longer bounces back

- `[ios]` The transcript's re-stick "glue" now fires only when the content
  grew while the reader was already at the bottom — plain scrolling changes
  the same geometry and used to yank any pull shorter than 200pt straight
  back down on release. Thread screen included.
- `[ios]` `defaultScrollAnchor(.bottom)` is scoped on iOS 18+ to initial
  offset + alignment: the all-roles form also re-anchors on content size
  changes, which a LazyVStack produces mid-scroll as row estimates resolve.
- `[ios]` `[qa]` New `ScrollBounceTests` UI suite and a
  `qa-seed-nav.mjs` seed script for the nav/scroll fixture channels.
- `[ios]` Build number bumped to 2.0 (19) for the TestFlight upload.

## Feature

- **Scrolling back through a conversation sticks where you stop.** A short
  pull no longer snaps back down to the newest message on iPhone.
