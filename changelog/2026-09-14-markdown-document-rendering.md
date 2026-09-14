# Render markdown documents instead of showing raw source

- `[web]` `[macos]` `[ios]` A `.md` artifact opens as a rendered document in the
  artifact viewer — headings, lists, tables, fenced code and mermaid — with a
  **View source** toggle and a copy-raw control. Closes #569.
- `[web]` `[macos]` A `.md` chat attachment renders in place instead of as raw
  monospace; long documents clamp to a fixed height with Expand. `[ios]` tapping
  a `.md` chip opens the rendered document in a sheet (iOS has no inline text
  cards at all).
- `[web]` `[macos]` `[ios]` Markdown routes ahead of the text branch everywhere
  (`isMarkdownFile` / `FileAttachment.isMarkdown`) — it is a subset of "text", so
  the text preview would otherwise claim it.
- `[macos]` `[ios]` New shared `Support/MarkdownDocumentView.swift`: document
  rendering over the existing `MarkdownBlocks` grammar, so both clients get one
  implementation and messages keep theirs untouched.

## Feature

- **Markdown documents now read as documents.** Open a `.md` file someone shared
  — as a channel doc or an attachment — and you see formatted headings, lists,
  tables, code blocks and diagrams instead of raw markdown. "View source" shows
  the original text whenever you want it, and you can copy it in one click.
