# macOS: the scroll-position restore holds through attachment loading

- `[macos]` A restore is now re-anchored through the layout-settling window:
  an attachment above the remembered row finishing its sizing after the
  restore scroll pushed the whole position down a viewport, so returning to
  a media-heavy channel landed a screen too high. Stops the moment the
  reader takes over.
