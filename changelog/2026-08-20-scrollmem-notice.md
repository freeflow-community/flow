# macOS: scroll-memory diagnostics survive an app restart

- `[macos]` Scroll-memory decision logs moved from info to notice level:
  info lives only in the in-memory buffer and evaporated with the app exit,
  which made the first field report undiagnosable after the fact.
