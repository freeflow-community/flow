# Bulleted/numbered lists and horizontal rules render on macOS and iOS

- `[macos]` `[ios]` The shared `MarkdownBlocks` grammar gained `ulist`,
  `olist(start:)` and `hr`, matching web's regexes — `- one` / `* two` /
  `+ three` are one list, `3.` keeps its start index, and `---` is a rule.
  Both message renderers draw them; markers inside a fence stay code.
- `[macos]` A rule is checked before a table, so `a | b` followed by `---`
  stays prose plus a rule (the separator carries no pipe) — web's behaviour.

## Feature

- **Lists and dividers now look like lists and dividers in the Mac and iPhone
  apps.** Bullets, numbered lists and `---` separators used to arrive as raw
  markdown characters; they now render the way they always have on the web.
