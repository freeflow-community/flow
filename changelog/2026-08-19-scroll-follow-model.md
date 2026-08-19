# One scroll owner for the chat transcript

- `[macos]` `[ios]` All follow/auto-scroll decisions now run through a single
  shared state machine (`TranscriptFollowModel`); the four independent scroll
  drivers that could disagree mid-transition are gone.
- `[ios]` The keyboard's show/hide brackets freeze follow decisions while the
  animation runs, with one re-stick at the end — the "Latest msgs" pill no
  longer flickers up when the keyboard rises.
- `[macos]` A composer resize (wrapping draft, attachment tray) now carries a
  pinned reader to the newest message instead of leaving the list scrolled
  into empty space — the mid-typing blank transcript.
- `[macos]` `[ios]` The jump pill is debounced (~150ms) so transient geometry
  can never flash it; my own message re-pins the follow on macOS too
  (web/iOS parity).

## Feature

- **Steadier chat scrolling.** The transcript no longer goes blank when you
  start typing, new messages land fully in view, and the "Latest msgs" button
  only appears when you have really scrolled away — not when the keyboard
  opens.
