# Chat polish: white chat background, roomier macOS message typography

- `[web]` `[macos]` The chat pane is now pure white instead of the shell's warm
  `#FBFAF8`; every other surface keeps it. macOS gets an `MC.chat` token rather
  than repainting `MC.base`, which the iOS app shares.
- `[macos]` Message body rhythm ported from web: 1.5 line-height, wider gaps
  between blocks and list items, and `list-disc`-sized bullet markers in the
  text colour. Long rich-text messages no longer read denser than on web.
- `[macos]` Inline `` `code` `` renders as web's chip — monospace on the warm
  code background in `#C2544A` — instead of bare monospace.

## Feature

- **Messages breathe on the Mac.** Bulleted and multi-paragraph messages now
  have the same spacing and line height as they do in the browser, inline code
  gets its tinted highlight, and the chat sits on a clean white background.
