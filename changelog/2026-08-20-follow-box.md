# Smooth scrolling again

- `[macos]` `[ios]` Per-frame scroll geometry no longer routes through
  SwiftUI-visible state: every frame was invalidating the transcript body,
  which fully re-laid the eager message stack (profiled at ~72% of
  main-thread time during a scroll). The follow model now lives in a
  reference box; only the rare signals SwiftUI renders (the jump pill) are
  mirrored into state, on change.

## Feature

- **Scrolling is smooth again.** The lag introduced alongside the recent
  transcript fixes is gone on both macOS and iOS.
