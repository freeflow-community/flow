# APNs polish: iOS notification prefs, and push that obeys them

- `[server]` Push now honours the per-user notification prefs and the DND
  status, gated at send time by the same `suppressAlertFor` the banners use.
  It never did: a muted kind still rang the phone.
- `[server]` A muted push carries the badge and nothing else (`{aps:{badge}}`,
  priority 5), so an unread row the badge stops counting can't happen.
- `[server]` `[web]` `[ios]` New `sound` pref (default on): `aps.sound` is
  omitted when off, web banners pass `silent`, and iOS presents `[.banner]`
  alone in the foreground.
- `[ios]` Notification settings screen under the account sheet — the six alert
  kinds plus the sound toggle. Closes the iOS half of the prefs-UI Parity gap;
  macOS still has none.
- `[server]` Badge-sync gets a rolling budget of 6 background pushes per user
  per hour. The 30 s window bounds a burst and nothing else: measured, a busy
  hour cost 119 and a read every two minutes cost 30, against Apple's "a few
  per hour". The cap holds the newest count rather than dropping it.
- `[server]` Removed `apns-collapse-id`: it was set for kind 3 only, which
  never alerts, so no push ever carried one — and collapsing the kinds that do
  push would replace unread mentions with the newest.
- `[server]` `[qa]` `test/badgeSyncBudget.test.ts` replays traffic profiles
  through the real module at 400:1 time scale and counts pushes per hour.

## Feature

- **Choose what your phone wakes you for.** iOS now has a Notifications screen
  under your account: turn off DMs, mentions, group mentions, thread replies,
  reactions or channel invites, and they stop reaching your phone — they still
  land in Activity and still count toward the badge.
- **Turn notification sounds off** and keep the banners, on the phone and on
  the web.
- **Muting now really mutes.** Turning a kind off, or setting a
  do-not-disturb status, used to silence the desktop while your phone rang
  anyway. It doesn't any more.
