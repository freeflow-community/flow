# Scheduled messages on macOS and iOS

- `[macos]` `[ios]` Scheduled panel behind a clock beside the Activity bell:
  one list, "Owned by me" filter, per-row schedule, destination, last-run
  status and "view output"; run-now / pause-resume / edit / delete for the
  author and admins only. macOS uses row buttons, iOS a row menu and swipes.
- `[macos]` `[ios]` Create/edit sheet with the same presets as web (once,
  hourly, every N hours, daily, weekly, custom cron), plus a composer entry
  point that prefills the current conversation and the typed draft.
- `[macos]` `[ios]` "🕐 SCHEDULED" badge on messages the scheduler posted —
  tooltip on macOS, tap-for-detail on iOS. A scheduled message now breaks
  author grouping, so it can't inherit a typed message's header and lose the
  badge.
- `[macos]` `[ios]` Shared `ScheduledMessage`/`Recurrence`/`ScheduleForm` in
  the layer both apps compile, so the two clients cannot drift on what a
  schedule means or how it reads.
- `[macos]` `[ios]` The "Post to" picker now shows which destination is
  selected without hunting for it — see the CHANGELOG Parity note; web still
  opens its list at the top.

## Feature

- **Scheduled messages now work on the Mac and iPhone apps, not just the
  web.** Write a message once and Flow posts it for you on a schedule — a
  standup prompt every weekday, a digest every 12 hours, a reminder to
  yourself next Tuesday. The clock next to the activity bell opens everything
  you have scheduled, where you can run one now, pause it, edit it or delete
  it; the clock in the composer schedules whatever you have just typed,
  already pointed at the conversation you are in.
- **You can tell an automatic message from a typed one.** Anything posted by a
  schedule carries a "SCHEDULED" badge next to the author's name, so nobody
  wonders why a colleague is posting the same standup prompt at 9:30 every
  morning.
