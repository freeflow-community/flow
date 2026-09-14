# Incoming messages scroll into view again

- `[macos]` A reply arriving while you sat at the bottom was left below the
  fold: the follow scrolled to the row before it had a height, and the
  correction was swallowed by the quiet window that same scroll had opened.
  The window now freezes pin decisions only — growth while pinned still glues.
- `[macos]` The transcript and the thread panel re-assert the end across the
  settling window after a message lands, so a row that sizes late (an agent's
  markdown, an image) is corrected instead of left short.
- `[macos]` The thread panel runs on the shared follow model now, so it stops
  yanking a reader who has scrolled up back down to the newest reply.
- `[ios]` Inherits the shared-model half for free; the per-view settle waits on
  the #332 scroll-target port (CHANGELOG Parity).

## Feature

- **Replies land in view.** On macOS, an answer arriving while you're at the
  bottom of a channel or thread now scrolls into view on its own — including
  one that keeps growing as it streams. Scroll up to read back and nothing
  moves you.
