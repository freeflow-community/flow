# Being added to a channel now notifies you

- `[server]` Adding someone to a channel writes a notification (kind 5) for
  them, anchored to the `member_joined` line so tapping it opens the channel.
  Joining a public channel yourself still notifies nobody.
- `[server]` Kind 5 gets its own `channelInvite` alert pref rather than
  inheriting `mention` — muting mentions must not silently mute invites.
- `[web]` `[macos]` `[ios]` Activity feed and banners render the new kind; web
  Settings gains a **Channel invites** toggle (on by default).

## Feature

- **You're told when someone adds you to a channel.** It shows up in Activity
  and on your unread badge instead of the channel quietly appearing in your
  sidebar. Turn it off under Channel invites in Settings.
