# Mermaid diagrams zoom on click

- `[web]` `[macos]` `[ios]` Clicking a rendered diagram opens it full-window,
  the way clicking an image does. Escape, a click beside it, or Close returns.
- `[web]` `[macos]` `[ios]` The zoomed diagram is a *second* sandbox frame
  rendering the same source, so the SVG still never leaves the isolated
  renderer (#229). Its chrome carries Copy source rather than Download or Open
  external — a diagram has no file behind it.
- `[web]` `[macos]` `[ios]` A frame swallows its own clicks, so the sandbox page
  now reports them: new `activate` and `dismiss` replies, plus a `fit:'window'`
  render mode that fills the frame instead of capping at 420 px.
- `[web]` Backdrop, button row, caption and the two ways out extracted to a
  shared `LightboxShell`; the image and video overlays now use it too.
- `[macos]` `[ios]` The overlay is presented natively, because the inline web
  view is sized to the diagram and could never hold something larger.
- `[qa]` Sandbox reply routing and both overlay states covered by unit tests.

## Feature

- **Zoom a diagram.** Click a diagram in a message and it opens full-window,
  scaled to fit, so a dense flowchart is readable. Copy source is there too.
  Press Escape or click beside it to go back. Keyboard users can use the new
  Zoom button above the diagram.
