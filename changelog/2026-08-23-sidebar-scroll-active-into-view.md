# Sidebar scrolls the active channel into view

- `[web]` `[macos]` Navigating to a channel by anything other than a sidebar
  click — a notification, a deep link, being added to a channel — left the
  sidebar at its old scroll position, so the highlighted row could sit below
  the fold (#319). The active row now scrolls itself back into view.
- `[web]` `[macos]` Minimal scroll: a row already on screen does not move, so
  clicking a channel in the sidebar still never jumps the list. Web computes
  the delta itself (`nearestScrollDelta`) rather than using
  `Element.scrollIntoView`, which would also scroll the row's ancestors;
  macOS uses `ScrollViewReader` with a nil anchor.

## Feature

- **The sidebar follows you.** Open a channel from a notification or a link
  and the channel list scrolls so you can see where you are, instead of
  leaving the highlighted channel off-screen.
