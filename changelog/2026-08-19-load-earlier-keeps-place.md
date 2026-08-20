# "Load earlier messages" keeps your place

- `[macos]` `[ios]` Loading older history now puts the row you were reading
  back at the top of the viewport once the page lands, instead of letting
  everything shift down by the height of the new content. Tapping it also
  unpins the follow — reading history is a decision to leave the end.
- `[macos]` Removed the dead per-channel scroll-memory store: its recorder was
  deleted in the scroll-blanking fix, so the restore branch could never run.

## Feature

- **Reading old history no longer loses your spot.** Load earlier messages
  and the transcript stays exactly where you were; new content appears above.
