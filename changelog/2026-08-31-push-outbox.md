# APNs 3/6: delivery outbox and worker

- `[server]` `pending_push` (migration `0041`) — rows written in the same
  transaction as the notification row. Push is not loss-tolerant the way WS
  publish is: a phone with no socket has nothing to backfill from, so a dropped
  push is a notification the user never learns about.
- `[server]` `services/pushOutbox.ts` — in-process worker draining them,
  started beside `startAppEventsWorker`. Copied from the Events API outbox,
  including `MAX_ATTEMPTS = 4`, the 5s/20s/80s backoff, the `SKIP LOCKED` claim
  with a lease, and auto-disable after sustained failure.
- `[server]` One row per *notification*: devices are resolved and the badge
  count computed at send time, so a phone registered after the commit still
  gets the push and the count is queried once rather than once per device.
- `[server]` `notifyReaction` and `notifyChannelInvite` now write their
  notification inside a transaction so the enqueue commits with it.
- `[qa]` 23 DB-backed tests: rollback-with-the-notification, send-time fan-out,
  retry/backoff/MAX_ATTEMPTS, 410 and sustained-failure device disabling, and
  an expired lease redelivering with no attempt consumed.
