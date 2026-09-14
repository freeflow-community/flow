# Sidebar: topic tooltip actually fires, and a hover ⋯ menu (#398, #399)

- `[macos]` `topicHelp(_:)` drops SwiftUI's `.help(_:)` for a click-through
  `NSView` overlay that owns the row's `toolTip`. `.help` gives a lazy list one
  tooltip owner, so AppKit armed it once on entering the sidebar and never
  re-read it: the first row hovered showed its topic, every row after it showed
  that stale one and then nothing (#398). A real view per row restores the
  per-row enter/exit AppKit needs. Fixes the header topic line too.
- `[macos]` Sidebar rows reveal a ⋯ button on hover (#399) that opens the same
  menu as right-click — `channelMenu` and the new `dmMenu` are each built once
  and used by both entry points, so they cannot drift.
- `[macos]` The ⋯ width is reserved whether or not it shows, so revealing it
  never moves the unread badge or re-truncates a name. Web reflows the row
  instead; ordering (badge, then ⋯) matches.
- `[ios]` Untouched — no hover to hang either on.

## Feature

- **Channel topics show up on hover again.** Pointing at a channel in the macOS
  sidebar shows its topic, every time — before, only the first channel you
  pointed at in a session would show one.
- **A ⋯ button on macOS sidebar rows.** Hover any channel or DM and a ⋯ appears
  at the end of the row; clicking it opens the same menu as right-clicking, so
  channel actions are there to find without knowing to right-click.
