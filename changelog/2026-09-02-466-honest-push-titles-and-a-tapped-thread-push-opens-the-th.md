# Honest push titles, and a tapped thread push opens the thread (#466, #472, #476)

- `[server]` Push alerts for channel activity (kind 3) no longer say "X
  mentioned you" — they title as `New activity in #channel`, and drop the
  subtitle their own title already said. Latent until kind 3 is allowed to
  alert; fixed before the trap springs.
- `[server]` `alertStringsFor`'s `default:` now type-checks the whole
  `NotificationKind` union, so a new kind is a compile error rather than a
  banner claiming a mention that never happened.
- `[macos]` The same three lines in the local banner's title switch, which had
  the identical `default:` — the two switches are contracted to move together.
- `[ios]` A tapped push for a thread reply now routes into the thread, scrolled
  to the reply, instead of stopping at the channel. The payload has carried
  `threadRootId` since #248; `ChannelScreen` also syncs its pushed thread route
  when the notification targets the channel already on screen.

## Feature

- **A push about a busy channel no longer claims someone mentioned you.**
  Notifications for a channel you follow now say what actually happened, so a
  "mentioned you" banner means it really was one.
- **Tapping a notification about a thread reply on iPhone opens the thread.**
  It lands on the reply itself rather than dropping you at the top of the
  channel to go find it.
