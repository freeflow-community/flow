# Copy button on rendered code blocks

- `[web]` `[macos]` `[ios]` Every fenced code block now carries a copy button
  that puts the block's raw text on the clipboard, with a checkmark for 1.5s.
  Also on the Mermaid parse-error fallback, which renders as a code block.
- `[web]` `[macos]` `[ios]` It sits bottom-right, not the usual top-right: the
  message hover menu owns the top-trailing corner on every client, and its last
  control is Delete.
- `[web]` New `CodeBlock` component behind `renderBlocks`; the native clients
  share one `CodeCopyButton` from `Support/`, which iOS compiles from the macOS
  target.
- Inline `` `code` `` is deliberately left alone — a click target on every
  backtick span fights text selection.

## Feature

- **Copy a code block with one click.** Code blocks in messages now have a copy
  button in the corner, so a long token or signup URL no longer has to be
  selected by hand — which was near impossible on a phone.
