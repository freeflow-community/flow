# Activity moves from the channel list to a bell in the workspace header

- `[web]` `[macos]` `[ios]` Dropped the pinned "Activity" row from the top of
  the sidebar channel list; the feed now opens from a bell button pinned to the
  right of the workspace name, so it can never scroll out of view (#385).
- `[web]` `[macos]` `[ios]` The unread-mention badge and the selected state
  moved onto the bell; the accessibility identifier is unchanged, so existing
  UI tests still find it.

## Feature

- **Activity is always one tap away.** The Activity feed now lives behind a
  bell next to your workspace name instead of a row at the top of the channel
  list, so it stays put however far you scroll — and the list holds only real
  channels. Unread mentions still show as a badge, now on the bell.
