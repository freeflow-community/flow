# Reactions and thread replies keep the bottom pinned

- `[macos]` A reaction or a thread reply arriving while you sat at the bottom
  was left just below the fold. Both grow an existing row rather than adding
  one (19pt for a chip, 22pt for a "N replies" pill), so the content bottom
  landed inside the 40pt re-pin slack — and that branch re-pinned and returned
  before the growth glue could run. It now re-pins *and* glues.
- `[macos]` Nothing else about the follow moves: growth inside the aligned band
  is still ignored (#280), and a reader who has scrolled up is still left alone
  (#334).

## Feature

- **Reactions and thread replies stay in view.** On macOS, a 👍 or a new
  thread reply landing while you're at the bottom of a channel now scrolls
  itself into view instead of hiding just under the composer.
