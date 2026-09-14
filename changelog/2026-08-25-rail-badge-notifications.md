# The workspace rail badge counts notifications, not unread messages

- `[server]` `[web]` `[macos]` `[ios]` #346's rail badge counted unread
  *messages*, so it disagreed with everything else and never cleared on the
  Activity feed. It now counts unread *notifications* — the same rows the
  Activity total and the channel sidebar numbers count (operator ruling
  2026-07-26) — so reading Activity drains it and the three surfaces agree.
  Clients move it on notification arrival/read instead of the message path.

## Feature

- **The workspace badge now clears when you catch up.** The number on each
  workspace icon matches the Activity feed: mentions, DMs, and replies that
  need you — and it goes away as you read them. Plain unread chatter no
  longer keeps the badge lit.
