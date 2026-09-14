# Scheduled messages

- `[server]` New `scheduled_messages` store plus an in-process ~30s ticker that
  claims due rows with `FOR UPDATE SKIP LOCKED` and posts them through the
  normal message-creation path as their author — so fanout, unreads, push and
  agent mentions behave exactly as if the message had been typed (#419).
- `[server]` `MessageDTO.scheduled` marks a message the scheduler posted.
  Additive: every client ignores it until it draws a badge.
- `[server]` Occurrences are computed in the row's IANA timezone from a stored
  rule (once / hourly / every N hours / daily / weekly / cron), so "daily at
  9 AM" stays at 9 AM across a DST change. Overdue rows fire **once** at boot,
  never one post per missed occurrence.
- `[server]` A row stops itself and DMs its author when they leave the
  destination or their account goes inactive. REST CRUD plus pause/resume and
  run-now; listing is scoped to the author and the destination's members.
- `[web]` Clock beside the Activity bell opens a workspace-wide **Scheduled**
  panel: one list, an "Owned by me" filter, per-row status/next-run and
  view-output, with actions shown only to the author and workspace admins
  (#420).
- `[web]` Create/edit dialog with schedule presets, a cron escape hatch and a
  "Post to" picker ("🔒 Just me" or a channel); the composer's clock schedules
  what you have typed into the current conversation.
- `[web]` Messages the scheduler posted carry a "🕐 SCHEDULED" badge and always
  start their own group — merged into the author's previous message they would
  inherit its header and lose the badge entirely.

## Feature

- **Write a message once and have Flow post it on a schedule.** The clock next
  to the Activity bell opens Scheduled, where you can set something up to post
  daily, weekly, every few hours, or just once — to a channel, or privately to
  yourself. It posts as you, so if it mentions someone (or an agent) they get
  the mention for real.
- **You can always tell.** Anything Flow posted for you carries a SCHEDULED
  badge next to your name, so an automatic message is never mistaken for one
  you just typed.
- **It stops itself when it should.** Leave a channel and the messages you had
  scheduled into it pause instead of failing quietly — and Flow tells you.
