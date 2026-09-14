# Apps section in the left nav: workspace-wide mini-app discovery (#394)

- `[server]` New `GET /v1/workspaces/:id/app-artifacts` — every `isApp` artifact
  in a non-archived channel that is public *or* the caller is a member of.
  Deliberately wider than the existing artifact list: a public channel's app is
  public, so it is discoverable before you join. Same visibility predicate
  `listChannels` already uses, so no new permission model.
- `[web]` `[macos]` Collapsible **Apps** section in the sidebar, hidden when
  empty, collapse state per device (`flow.sidebarAppsCollapsed`). Rows show the
  app name over its host channel in muted text; the host channel is resolved
  from the channel list, which already carries public channels you're not in.
- `[web]` `[macos]` Clicking a row joins the host channel if needed and opens
  the channel with the app pane, in one action. The join awaits the artifact
  refetch first — the side panel builds its tabs from the *member* artifact
  list, so opening earlier gives an empty panel that closes itself.
- `[macos]` Apps-section rows are keyed `app-<artifactId>`, not the bare
  artifact id: the same app also renders as a nested artifact row under its
  channel, and duplicate identities in the sidebar's one `LazyVStack` made
  SwiftUI drop a row (it reserved height and drew nothing).
- `[web]` `[macos]` Mini apps now draw a 🧩 rather than the generic link glyph,
  in the new section and in the existing artifact rows and panel tabs.
- `[ios]` Untouched — out of scope for the issue; logged as a Parity gap.

## Feature

- **Find your team's mini apps without hunting for the channel.** The sidebar
  has a new **Apps** section listing every app in the workspace you're allowed
  to see, with the channel it lives in underneath the name. That includes apps
  in public channels you haven't joined — click one and Flow takes you into the
  channel with the app already open. On the web and Mac apps.
