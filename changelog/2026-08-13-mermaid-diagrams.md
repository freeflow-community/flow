# Mermaid diagrams render in chat messages

- `[web]` A ```` ```mermaid ```` fence renders as a diagram instead of a code
  block, in a `sandbox="allow-scripts"` iframe with no `allow-same-origin` —
  the SVG never enters the app document.
- `[web]` New static asset `/mermaid/sandbox.html`, the single renderer; the
  mermaid bundle is copied out of `node_modules` at predev/prebuild rather than
  bundled, so it stays out of the app chunk.
- `[macos]` `[ios]` The same page, hosted in an ephemeral `WKWebView` from the
  workspace's own server, so all three clients share one renderer and one
  mermaid version.
- `[macos]` `[ios]` `MarkdownBlocks.Segment` gains `.mermaid`, matching web's
  fence-info-string rule; a diagram fence is still code for outgoing
  transforms.
- Untrusted input is held to `securityLevel: 'strict'`, no HTML labels, a
  20 000-character source limit and a 5 s render timeout. Invalid syntax falls
  back to the original code block plus the parse error.
- `[qa]` `packages/server/scripts/qa-seed-mermaid.mjs` seeds a channel covering
  every supported diagram type and the invalid-syntax fallback.

## Feature

- **Diagrams in messages.** Put a diagram in a fenced code block tagged
  `mermaid` and it draws as a picture instead of showing as code — flowcharts,
  sequence, state, class, ER, gantt and pie, in Flow's own colours. A wide
  diagram scales to fit, on a phone as well as a desktop. If the diagram has a
  mistake in it you see your original text and the error, so nothing is lost,
  and every diagram has a "Copy source" control.
