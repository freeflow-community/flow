# Owners and admins can permanently remove messages

- `[server]` Workspace owners and admins may permanently remove any accessible
  non-system message or existing tombstone. Ordinary members keep soft-delete
  access for their own live messages; authenticated agents retain their own
  ephemeral-status cleanup path.
- `[server]` A thread-root purge removes its replies atomically. Reply rollups,
  reactions, pins, notifications, unfurls, and unreferenced attachments are
  reconciled without leaving a message tombstone.
- `[web]` `[macos]` `[ios]` Role-aware destructive actions explain whether a
  complete thread will disappear, and local caches, open threads, Activity,
  files, pins, and unread counts converge after the purge event.
- `[qa]` Permission, database-cascade, cache-idempotency, multi-window, and
  cross-platform policy tests cover the moderation path.

## Feature

- **Owners and admins can make a message disappear completely.** Permanent
  delete works on messages from people, bots, and agents—even an existing
  “message was deleted” notice—and deleting a thread starter removes its replies
  too. Regular members still get the usual deletion notice for their own posts.
