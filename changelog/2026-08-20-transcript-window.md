# Windowed transcripts + steadier follow during bursts

- `[macos]` `[ios]` The transcript now shows the newest ~100 cached messages
  instead of everything ever cached; "Load earlier" widens the window
  (instantly from cache, then from the server). Every ordinary channel open
  is on the exact eager layout path now — the LazyVStack estimate bugs
  (parked/blank opens, misplaced scroll-memory restores in big channels)
  can't reach it, and render cost is bounded.
- `[macos]` `[ios]` The follow model ignores unpin evidence for 0.4s after
  its own animated scrolls: during message bursts the animation's rebound
  frames read as an upward scroll, silently unpinning the follow — new
  messages stopped auto-scrolling.

## Feature

- **Big channels behave like small ones.** Busy channels open instantly at
  the newest messages, auto-scroll keeps up during rapid bursts, and (on
  macOS) switching back to a channel restores your reading position
  reliably.
