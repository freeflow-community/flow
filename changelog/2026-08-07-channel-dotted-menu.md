# Dotted menu for channel operations

- `[web]` `[macos]` `[ios]` One "⋯" menu in the channel header replaces the
  separate pin (and, on iOS, artifacts) buttons: pinned messages, the channel's
  artifacts, and channel options.
- `[web]` `[macos]` `[ios]` Channel options — name, topic and delete — behind
  that menu. Delete is the server's archive; #general offers neither.
- `[ios]` First rename/topic UI on iOS; new `ChannelOptionsTests` cover it, and
  `ArtifactsTests` now reach artifacts through the menu.

## Feature

- **One ⋯ menu per channel.** Pinned messages, the channel's artifacts and
  channel settings now live together at the top right of every conversation,
  the same on the web, the Mac and the iPhone.
- **Rename a channel, set its topic, or delete it** from that menu — on the
  iPhone too, which couldn't do any of it before. Deleting keeps the history
  and just retires the channel; #general can't be renamed or deleted.
