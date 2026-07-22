# Phase 10 — Web & macOS notifications (PROPOSED)

Notifications from our chat app are critical. They alert users when important events occur.

In addition to implementing notifications themselves, we should add User settings to control
which notifications they receive. These should take over the "Profile" popup we currently have.

Key notifications:
- Any messages in a Direct channel
- Anyone '@' messages the current user
- '@here' messages for any channel the user is in
- A reply is added to any thread started by the user or where the user has replied themselves

If the user sets their status to Focusing/In a meeting/At lunch/Do not disturb then notifications
should be suppressed until the status changes again.

In this phase we will only implement notifications for the web and native macOS clients (no iOS).

## What already exists (do not rebuild)

The notification *pipeline* shipped in phase 2 and covers all four key cases:

- `notifications` rows + `notification.created` events on the per-user subject,
  with kinds: `0`=mention (direct **and** group mentions `<!channel>` /
  `<!everyone>` / `<!here>`), `1`=dm, `2`=thread_reply (root author + prior
  repliers — exactly the brief's thread rule), `3`=channel activity
  (per-channel `notify_level=all`).
- Web: bell (`NotificationsBell.tsx`) + OS banner via `new Notification(...)`
  in `Main.tsx maybeBanner` when the event arrives (tab must be open; no
  service worker).
- macOS: bell popover (`NotificationsView.swift`) + `UNUserNotificationCenter`
  banners (`Banners.swift`, fired from `SyncEngine`) + dock badge.
- Status: free-form `statusEmoji`/`statusText` with canned presets already
  including 🎧 Focusing, 🗓️ In a meeting, 🍽️ At lunch, 🚫 Do not disturb —
  the brief's four.

So this phase is about **control**, not plumbing: per-user alert preferences,
status-driven suppression, and the settings UI for both.

## The one new server concept: `suppressAlert`

Today the alert decision is made client-side (web/macOS fire a banner when the
WS event arrives). Move it server-side so preferences sync across devices and
the same gate works for APNs later: `NotificationDTO` gains
**`suppressAlert: boolean`**, computed at fan-out (and at REST list time) per
recipient from (a) their notification prefs and (b) whether their current
status suppresses alerts. Clients fire OS banners only when `suppressAlert` is
false; the bell/badge still updates for every notification row.

**Rows are always written, regardless of prefs or status.** Prefs gate
*alerts*, not the inbox — the bell stays a complete record (ruling question 2).

## User notification preferences

New `users.notification_prefs` (JSONB, default `{}` = all on). Four toggles:

| Pref | Gates | Default |
|---|---|---|
| `dm` | kind 1 (any DM/group-DM message) | on |
| `mention` | kind 0 via direct `<@user>` mention | on |
| `groupMention` | kind 0 via `<!here>` / `<!channel>` / `<!everyone>` | on |
| `threadReply` | kind 2 | on |

Distinguishing direct from group mentions requires carrying a **subkind**
(`mention` | `here` | `channel`) on the planned notification at
`computeRecipients` time — today both collapse into kind 0. The subkind feeds
the `suppressAlert` computation; persisting it on the row is optional
(useful for bell grouping later; ruling question 4).

Per-channel `notify_level` (mute/all) is untouched: mute still suppresses the
row entirely, `all` still creates kind-3 activity rows (always
`suppressAlert: true` — activity never banners; same as today).

API: `PATCH /v1/me` accepts `notificationPrefs` (merged shallowly) and echoes
it in `UserDTO`.

### Presentation pref: persistent banners (web)

`new Notification(...)` without flags auto-dismisses even when the browser's
macOS notification style is "Alerts" — but `requireInteraction: true`
persists until dismissed, regardless of that setting (verified live
2026-07-21 on the local Chromium build: unflagged vanished, flagged stayed).
Add a **`persistentBanners`** pref (default off): web passes
`requireInteraction: true` when constructing OS notifications. Per-platform
support varies (Android ignores it); harmless where unsupported. macOS-native
persistence is the user's own alert-style setting for the Flow app in System
Settings — no code needed; `.timeSensitive` interruption level (breaks
through Focus) is out of scope unless ruled.

## Status-driven suppression

`users.status_suppress_alerts boolean default false`, set via `PATCH /v1/me`.
The status picker marks the brief's four presets — Focusing, In a meeting, At
lunch, Do not disturb — as suppressing: picking one sets the flag, picking
💬 Available (or any non-suppressing status, or clearing status) clears it.
Suppression is **until the status changes again** — no timers, no schedules
(out of scope, ruling question 5).

While the flag is set, every `suppressAlert` computes true. Presence/status
display to other users is unchanged — the flag only gates alerts.

## Client work

**Web**
- `ProfileModal` becomes **Settings**: existing profile fields plus a
  Notifications section (the four toggles, live-saved via `PATCH /v1/me`).
- `maybeBanner` trusts `suppressAlert` from the event instead of firing
  unconditionally; OS Notification permission flow unchanged.
- `StatusPicker` sets/clears `statusSuppressAlerts` alongside emoji/text;
  suppressing presets get a small "pauses notifications" hint.

**macOS**
- Settings parity: the profile popup gains the same Notifications section.
- The status picker presets map to the same suppress flag.
- `SyncEngine`'s banner path checks `suppressAlert` before `Banners.show`;
  dock badge keeps counting rows (badge ≠ alert).

## Explicitly out

- iOS (brief) — including APNs push; the `suppressAlert` gate is designed to
  be the point APNs consults later.
- Email digests, keyword notifications, per-keyword alerts.
- DND schedules / auto-expiring statuses.
- Web service-worker push (tab-closed notifications) — a separate phase if
  ever; this phase's web banners still require an open tab.
- Sound customization, per-channel banner overrides beyond existing
  `notify_level`.

## Verification

- Two-client live test (web + macOS as different users): each toggle off →
  no OS banner but the bell still increments and the row appears; re-enable →
  banners resume.
- Status: set 🎧 Focusing → mention + DM produce no banner on either client;
  bell updates; set 💬 Available → banners resume.
- `<!here>` vs direct mention exercises the subkind split; thread reply to a
  prior participant; channel mute (notify_level=0) still suppresses the row.
- Prefs sync: change a toggle on web, verify macOS honors it without
  re-signing-in (fresh events carry the flag — no client caching of prefs).
- CHANGELOG: entries per client + server; Parity section untouched (iOS
  already lists push as its gap).

## Pre-flight questions (operator)

1. **Bell vs alert semantics**: prefs gate banners only (bell stays complete —
   recommended), or should muted kinds also vanish from the bell?
2. **Group-mention granularity**: one `groupMention` toggle (recommended —
   same interrupt class), or split `@here` from `@channel`/`@everyone`?
3. **Which presets suppress**: the brief's four (Focusing, In a meeting, At
   lunch, Do not disturb) — should 🌴 Vacationing or 🤒 Out sick also
   suppress? Recommended: no (brief's four only).
4. **Persist the subkind** on notification rows (enables bell grouping by
   mention type later) or keep it fan-out-only (smaller migration)?
   Recommended: persist — one nullable column.
5. **Status expiry**: confirm no "clear after 1 hour / tomorrow" options this
   phase (Slack has them; recommended: out).
