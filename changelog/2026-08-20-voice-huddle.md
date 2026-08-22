# Voice huddles (Phase 1: audio-only)

- `[server]` New in-memory huddle store modeled on `channelIndicators`
  (#137): per-channel roster, LiveKit access-token minting (audio-only
  enforced via `canPublishSources`), a webhook reconciliation safety net,
  and boot-time resync against LiveKit's own room state. New
  `POST /v1/channels/:id/huddle/join`, `POST /v1/channels/:id/huddle/leave`,
  and `POST /v1/livekit/webhook`.
- `[web]` `HuddleProvider` owns the LiveKit `Room` connection and local mute
  state at the app level, so a huddle survives navigating between channels.
  New persistent `HuddleMiniBar`; a Join/Leave Huddle control in the channel
  header.
- `[macos]` `AppState` owns the huddle connection app-wide (not per-window).
  New persistent `HuddleBar`; a Join/Leave Huddle control in the channel
  header. `make-app.sh`/`dist.sh` extend the existing Sparkle XCFramework
  embedding/signing to cover LiveKit's two frameworks.
- `[ios]` Same client shape as macOS (shared `AppState`/`SyncEngine`/models):
  a persistent `HuddleBar` and a toolbar Join/Leave Huddle control.
  Background audio (`UIBackgroundModes: audio`) so a huddle survives
  backgrounding, not just in-app navigation.

## Feature

- **Voice huddles.** Any standard or private channel can now host an
  ambient, audio-only voice call — no ringing, no push. Anyone who can see
  the channel can see a huddle is live and join or leave freely, and it
  keeps running in the background as you navigate elsewhere. You join
  muted by default.
