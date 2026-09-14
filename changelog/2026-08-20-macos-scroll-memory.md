# macOS remembers your place in a channel

- `[macos]` Per-channel scroll-position memory, rebuilt for real: a passive
  per-row preference tracks the top-visible message, and switching back to a
  channel within 10 minutes restores it (through the follow model — still a
  single scroll driver). A reader at the bottom clears their entry, and
  expired or unloaded positions fall back to the bottom.

## Feature

- **macOS: switching channels keeps your place.** Come back to a channel
  within 10 minutes and you are exactly where you left off in the history;
  after that it opens at the newest messages.
