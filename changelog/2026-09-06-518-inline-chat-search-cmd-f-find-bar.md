# Inline chat search: cmd-F find bar (#518)

- `[web]` `[macos]` cmd-F (ctrl-F on non-Mac web) opens a find bar under the
  channel header that searches the loaded transcript — no server round-trip and
  no history paging. Enter/Shift-Enter walk the matches and wrap; Esc and the ✕
  close, clear and un-highlight.
- `[web]` Matches are painted with the CSS Custom Highlight API rather than
  `<mark>` wrappers: React owns the message DOM, and spliced wrappers do not
  survive a row re-render.
- `[macos]` Highlights go into the `AttributedString` each row already builds,
  and the search reads the characters a row actually draws — so `**release**`
  is found as `release`, and mentions by their rendered `@name`. Blocks that
  can't carry a highlight (tables, diagrams) are deliberately not counted.
- `[macos]` The shortcut is an **Edit ▸ Find in Conversation…** menu item, which
  is also what stops AppKit offering its own find bar on the composer.

## Feature

- **Press cmd-F to search the conversation you're looking at.** A find bar
  opens under the channel name, highlights every match in the messages already
  on screen, and Enter walks you through them — wrapping back to the first
  after the last. A counter shows where you are ("3/12", or "0/0" when nothing
  matched). Esc or the ✕ puts everything back.
