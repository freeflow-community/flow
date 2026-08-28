# Deterministic sync-bar timing tests

- [macos] `SyncIndicator` is now generic over a `Clock`; `SyncBarTests` drive
  a virtual `TestClock` (new test-only `swift-clocks` dependency) instead of
  sleeping on the real one — the test flaked both ways on slow CI runners.
  The tests now cover the shipped 250/500ms numbers exactly. No behavior
  change in the app.
