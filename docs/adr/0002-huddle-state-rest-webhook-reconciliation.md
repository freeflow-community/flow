# Huddle state: REST-driven, webhook-reconciled, ephemeral

A voice huddle's join/leave state is **REST-driven, with LiveKit webhooks as
a reconciliation safety net** — not webhooks as the sole source of truth.
LiveKit's own docs note webhook delivery has no guarantees, and this repo
already solved the identical reliability problem for `channelIndicators`
(#137) with the same shape: an explicit action as the primary path, a
disconnect/expiry signal as the backstop. Applying a proven pattern here
beat inventing a new one.

The store is **ephemeral, in-memory, and holds no DB table** — mirroring
`channelIndicators` again. Unlike that store, though, huddles.ts is
explicitly a *cache* of LiveKit, not the source of truth: LiveKit's own RTC
layer already knows who's really connected, so the server reconciles its
cache against LiveKit's REST API at boot (see `decision_log.md`,
2026-08-20) rather than trusting its own memory to survive a restart.
