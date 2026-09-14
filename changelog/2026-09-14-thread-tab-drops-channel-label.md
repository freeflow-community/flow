# Thread tab drops the "in #channel" label (web, macOS)

- `[web]` `[macos]` The side panel's Thread tab no longer says "in #channel" /
  "with <names>" after "Thread" (#417's parent label) — it duplicated the
  channel already on screen next to the panel. iOS keeps its thread header,
  where the parent channel isn't otherwise visible.

## Feature

- **Cleaner thread panel.** On web and macOS the thread tab now just says
  "Thread", without repeating the name of the channel you're already in.
