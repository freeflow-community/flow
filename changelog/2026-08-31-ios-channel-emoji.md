# Channel emoji on iOS (#438)

- `[ios]` Channel list rows draw the channel's emoji after the name, in both
  `channelRow` and `dmRow`, via one `channelEmoji(_:)` helper — the same
  placement web and macOS use.
- `[ios]` No new plumbing: iOS already compiles the shared `Channel.emoji`
  field, the `v19` cache migration and the `channel.emoji` event handler, so
  live updates and relaunch persistence came with the render.
- `[ios]` `ChannelEmojiTests` added to `FlowUnitTests`, which exists to stop
  shared-layer rules passing on macOS while rotting on iOS.
- `[qa]` Parity: #396's iOS divergence closes. The `channel.indicator` spinner
  (#137) is still absent on iOS and stays a gap on its own.

## Feature

- **Channel emoji now show on iPhone.** A channel's status glyph — 🚧, ✅, 🔥 —
  appears after its name in the channel list, changes the moment someone sets or
  clears it, and is still there when you reopen the app.
