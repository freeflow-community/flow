# Workspace unread badges on the sidebar rail

- `[server]` `[web]` `[macos]` `[ios]` Every workspace icon in the rail now
  carries a count of unread messages across the channels you're in there, so
  activity in a workspace you're not looking at is visible without switching.
  Caps at `99+`; nothing is drawn at zero; muted and archived channels don't
  count.
- `[server]` `/v1/me/workspaces` returns `unreadCount` per workspace, one
  grouped query with the same rules `listChannels` applies per channel. It's
  optional on the DTO — absent means "not computed", so a single-workspace
  fetch can't overwrite a real badge with a stale zero.
- `[web]` Live off the socket: someone else's message refreshes the workspace
  list, and reading a channel refreshes it again.
- `[macos]` `[ios]` GRDB migration v18 caches the count; arrivals and reads
  move it locally rather than round-tripping, and it settles up against the
  server when a workspace is opened.
- `[ios]` The rail's scroll content is now full width — it was clipping the
  badge's outer edge.

## Feature

- **See where the unread messages are without switching workspaces.** Each
  workspace icon in the sidebar rail shows how many unread messages are waiting
  in that workspace, counting up to `99+`, and the number moves as messages
  arrive and as you read them. On iOS the workspace switcher names the count
  too. Muted channels stay quiet.
