# APNs 4/6: payload builder, badge and silent badge-sync

- `[server]` `push/payload.ts` — the documented alert payload: `aps.alert`,
  `sound`, `badge` = `unreadCount(userId)`, `thread-id` = channelId, plus the
  routing keys `workspaceId`/`channelId`/`messageId`/`threadRootId` (omitted
  top-level) and `notificationId`. Those are verbatim the macOS banner's
  `userInfo`, so iOS tap-routing reuses `AppState.openNotification`.
- `[server]` Title and body are ports of SyncEngine's `.notification` switch
  and `MentionRendering.plainText`, so the same mention reads the same on the
  Mac and the phone. Body is one-lined and cut to 180 code points.
- `[server]` `FLOW_PUSH_BODY_PREVIEW` (default on) is the operator switch for
  PUSH_APNS.md open question 1: off sends no body and titles a DM "Alice sent
  you a message". **No ruling in `decision_log.md` yet** — shipped on the
  spec's recommended option (a).
- `[server]` Headers: `alert`/priority 10/~1 h expiry, `apns-collapse-id` =
  channelId for kind 3 only.
- `[server]` `services/badgeSync.ts` mirrors every `notification.read` publish
  as a background push (`content-available: 1`, priority 5, count only), so
  reading on the laptop drops the phone's badge. Throttled to one per user per
  30 s and dropped when an alert push for that user landed after it was queued
  — Apple meters background pushes and takes the budget away silently.
- `[qa]` 34 tests: payload shape and key set, per-kind titles, mention
  rendering, truncation and the 4 KB cap, the switch both ways, collapse-id,
  badge maths through a real drain, a `simctl`-ready dev-driver file, and the
  badge-sync coalescing window and both suppressions.
