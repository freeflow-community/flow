# Schedule sheet no longer discards what you typed or picked

- `[ios]` Changing a scheduled message's destination did nothing and blanked
  the message body. The "Post to" picker is a `.navigationLink`, so choosing a
  channel pushes and pops a screen — which re-ran the sheet's `.task`, and its
  `load()` re-seeded the body and channel from the target every time.
- `[ios]` `[macos]` The sheet now seeds those fields once in `init` (they come
  from the target, which never changes) and `load()` only refreshes the
  destination list, resolving the selection non-destructively.
  `ScheduleDestinations.resolve` keeps a selection that is still on offer.
- `[macos]` `[ios]` `ScheduleEditorTests` covers the resolve rule and the
  editor's opening state, compiled into both test targets.

## Feature

- **Fixed on iPhone: changing where a scheduled message posts.** Picking a
  different channel now sticks, and it no longer clears the message you had
  written.
