# macOS: the content pane switches channels in one frame

- `[macos]` Channel-scoped views read the new channel's cached rows during the
  body that renders the switch, instead of waiting for `.task(id:)` to
  re-point their observers — that task is an async main-actor hop, so under
  load the pane painted the *previous* channel's header and transcript under a
  sidebar that had already moved (#447).
- `[macos]` Same treatment for the pieces that lagged regardless of that race:
  the header's member avatars (a network fetch), the "Load earlier" window,
  and the side panel's thread-tab channel name.
- `[macos]` A pinned-messages request cancelled by switching channel no longer
  raises an error dialog — clicking through channels quickly landed on the last
  one under "Couldn't load pinned messages: cancelled".

## Feature

- **Switching channels lands in one step.** The header, messages and composer
  now change together with the sidebar highlight, instead of the old channel
  lingering for a beat while the new one loaded. Clicking quickly through
  several channels settles on the last one cleanly.
