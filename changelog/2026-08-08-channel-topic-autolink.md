# Channel topics auto-link URLs

- `[web]` `[macos]` The channel-header topic renders through the same inline
  renderer as a message body instead of as plain text, so a bare URL in a topic
  is a real link — new tab on web, system browser on macOS (#194).
- `[macos]` Topic colours are set per run, not with a view-level
  `.foregroundStyle`, which would have painted the link the same muted grey as
  the prose around it.

## Feature

- **A link in a channel topic is now clickable.** Put a URL in a channel's
  topic and it opens when you click it, instead of sitting there as grey text
  you have to copy out by hand.
