# Channel visit clears thread-reply badges (#533)

- `[server]` Visiting a channel now reads its thread-reply notifications too,
  not only top-level ones — the sidebar badge counts them, so leaving them out
  made the number impossible to clear from the channel itself.
- `[server]` The channel read cursor only ever moves forward, so a client
  re-sending a cached cursor can't un-read the timeline.
- `[web]` `[macos]` `[ios]` Clicking the channel you're already in re-runs the
  read pass instead of doing nothing, and still opens a waiting thread (#441).

## Feature

- **A channel's badge clears when you visit it.** Unread replies inside threads
  used to keep the number on a channel — and the app and dock badges — stuck
  until you opened each thread one by one. Opening the channel now clears them,
  and clicking a channel you're already in does it too, which is what most
  people try first.
