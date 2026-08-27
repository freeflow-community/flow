# Back/forward over channel visit history (#386)

- `[web]` `[macos]` Back and forward buttons in the workspace header, beside the
  Activity bell. Disabled and dimmed at the ends of the history; ⌘/Ctrl+[ and
  ⌘/Ctrl+] mirror them (web ignores them while the caret is in a text field).
- `[web]` `[macos]` The history is a plain value — `pushNav`/`NavHistory.record`
  collapses a re-visit of the current view and truncates the forward branch, and
  back/forward only move a cursor. `selectChannel` is now "record the visit, then
  show it"; back/forward call the same *show* step, so they cannot drift from
  what clicking a channel does.
- `[macos]` Entries are a `NavView` enum, not a channel id: the Activity feed
  covers the pane while the channel selection stays behind it, so back out of the
  feed has to uncover that channel. Per-window, like the rest of the selection.
- `[web]` `[macos]` Leaving or archiving a channel drops it from the history
  rather than leaving a back target that lands on a blank pane. In memory only —
  a workspace switch or sign-out starts fresh.
- `[ios]` Untouched — the phone's navigation model is a stack with its own back.

## Feature

- **Back and forward buttons for the channels you've been in.** The workspace
  header now has ‹ and › next to the Activity bell that walk this session's
  visit history, the way a browser does — jump into a channel to check
  something and one click puts you back where you were. Going somewhere new
  after going back drops the forward trail, and the buttons dim when there's
  nothing that way. ⌘[ and ⌘] do the same from the keyboard.
