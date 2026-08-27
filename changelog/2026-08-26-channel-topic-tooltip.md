# Channel topic on hover (#392)

- `[web]` New `useHoverTooltip` — 500ms dwell, plain text, wraps at 300px,
  portalled so the sidebar's scroll container can't clip it. Anchored to the
  whole channel row, not the name span: the row is what a pointer lands on.
- `[macos]` `.topicHelp(_:)` puts the topic in a native tooltip on the sidebar
  row and the header's truncated topic line. Applied only when a topic exists —
  `.help("")` still arms an empty bubble.
- `[web]` `[macos]` No new fetch path: both read the `topic` the clients already
  sync, so an edit shows up without a reload.
- `[ios]` Untouched — no hover affordance to hang it on.

## Feature

- **See what a channel is about without opening it.** Hover a channel in the
  sidebar and its topic appears in a tooltip; channels with no topic show
  nothing. Hovering the topic under a channel's name reveals it in full when
  it's too long for the one line there.
