# Thread replies scroll into view (iOS)

- `[ios]` The thread screen steers its scroll with the shared
  `TranscriptFollowModel` instead of following every new reply: my own reply
  re-pins and lands in view, someone else's leaves a back-scrolled reader
  where they are.
- `[ios]` Adds the arrival settle pass the channel list already had — a reply
  is scrolled to before its row has a height, so the first landing comes up
  short. Keyed on row identity, so the server echo costs no second jump.
- `[ios]` Drops the hand-maintained `jumpOwnsScroll` latch for the model's
  `focusEngaged()`; one owner of the scroll position instead of two.
- `[qa]` `ScrollToMessageTests` gains #494's criteria: three replies in a row
  each land in view, and a REST-driven reply from another user does not move
  the reader.
- `[macos]` No code change — the thread panel moved to the same model in
  \#334/#360; verified against the criteria.

## Feature

- **Your thread replies land in view on iPhone.** Send a reply in a long
  thread and it scrolls into sight, however far up you were reading — and
  replies from other people no longer yank you back down.
