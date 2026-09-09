# Narration stays in one piece when a long turn rolls over

- `[bridge]` A turn that relays more than 2000 characters opens a second
  narration message, and ids are time-ordered — so it landed *below* the live
  `🤖 thinking…` row and split what the agent said either side of it. The row
  is now re-posted under the new message, so commentary stays in reading order
  with the live row last (#528).
- `[bridge]` Bumped to 0.34.2.

## Feature

- **An agent's running commentary no longer scrolls away mid-turn.** On a long
  turn the text it had already written used to get stranded above the live
  "thinking…" line and drift out of view until the turn finished. It now stays
  put, in the order it was said, with the thinking line underneath it.
