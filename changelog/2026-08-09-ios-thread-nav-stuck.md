# iOS: navigation no longer gets stuck after leaving a thread

- `[ios]` Made `ChannelScreen`'s thread binding the single owner of the
  open-thread record and restore a parked thread only on the screen's first
  appearance. The old split (ThreadScreen recorded the open on its own
  appearance; every reappearance re-pushed) could push a destination in the
  middle of a pop on a slow link, corrupting the NavigationStack — after that
  no channel switch or thread push landed.
- `[ios]` `[qa]` New `ThreadNavTests` UI suite: Back, edge swipe, cancelled
  half-swipe, and rapid open/close cycles, then reopen + switch channels.
- `[ios]` Build number bumped to 2.0 (17) for the TestFlight upload.

## Feature

- **Threads no longer jam navigation on iPhone.** After opening a thread and
  going back, switching channels and opening threads keeps working — on slow
  connections this could previously freeze all navigation until a restart.
