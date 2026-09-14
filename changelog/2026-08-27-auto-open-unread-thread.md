# Clicking a channel opens the thread holding its oldest unread

- `[server]` `listChannels` now reports `oldestUnreadThreadReply`
  (`{ rootId, replyId }`) when a channel's oldest unread is a thread reply —
  computed from the unread-notification rows that already feed
  `unreadThreadRootIds`, plus the oldest unread top-level message id, so no
  unread or badge math changes (#327).
- `[web]` A sidebar click on such a channel opens the channel *and* that
  thread, scrolled to the first unread reply, via the existing jump-to-message
  path. Everything else — top-level unreads, mixed, none, re-clicking the
  channel you're already in — behaves exactly as before.
- `[server]` `[web]` Tests for the four unread shapes and for the click.

## Feature

- **Unreads hiding inside a thread are one click away.** When a channel's badge
  comes only from replies in a thread, clicking the channel now opens that
  thread on the first reply you haven't read, instead of showing you an
  unchanged main timeline. If an unread message in the channel itself is older,
  nothing pops open — and when several threads are waiting, you get the one
  with the oldest unread first.
