# Ambient-turn spinner clears when a message lands mid-turn (#534)

- `[bridge]` A follow-up turn now keeps a direct reference to its own progress
  reporter. It used to read it back out of the live-run slot, which a message
  arriving mid-turn had already taken — so the reporter was never finished and
  its 30s interval re-asserted the channel spinner forever.
- `[bridge]` A solicited turn finishes a displaced follow-up turn's reporter
  before claiming the slot, so one channel never carries two live spinners.
- `[bridge]` Hardening from the same audit: `progress.start()` moved inside the
  turn's `try`, a failed end-of-turn indicator clear is retried, and JSON API
  calls get a 30s deadline so a hung request can't stall a turn.

## Feature

- **A channel's activity spinner no longer gets stuck on.** If you message an
  agent while it is already working, the spinner stops when the work does
  instead of spinning until the agent restarts.
