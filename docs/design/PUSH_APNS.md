# iOS push notifications over APNs (PROPOSAL)

Flow's notification system is complete server-side — rows, kinds, the
`suppressAlert` gate, per-user prefs, and (since #63) a server-authoritative
unread count. What's missing on iOS is the **last hop**: a phone whose app
isn't running never hears about any of it. The WS socket is suspended in the
background, so `Banners.show` on iOS is a deliberate no-op and the app-icon
badge only updates while the app is alive.

This is the design for closing that gap. Nothing here is built yet.

Status: proposal. Deferred from phase 7 (decision log 2026-07-20, ruling 1)
and tracked as the standing iOS Parity gap in `CHANGELOG.md`.

## The principle: push is a transport, not a second notification system

Every decision below follows from one rule: **APNs delivers what the WS event
already carries, to devices instead of sockets.** The recipient set, the
kinds, the precedence, the alert gate — all of it is already computed once, in
`services/notifications.ts`, and push must not fork any of it. Concretely:

- The fan-out point stays `publishNotifications` / `notifyReaction`. Push is a
  second consumer of the same per-recipient decision, not a new decision.
- `suppressAlert` (phase 10) is the alert gate for push too — it was designed
  for exactly this (`phase10.md`: "the same gate works for APNs later").
  Prefs and DND set on web silence the phone with no extra code.
- Whether to *show* a banner for a channel the user is currently looking at
  stays a **client** call, as it already is on web and macOS. iOS decides in
  `UNUserNotificationCenterDelegate.willPresent`. The server stays dumb about
  what's on screen.

## Server: the three pieces

### 1. Device-token registry

New table (migration `0025_device_tokens.sql`):

```sql
CREATE TABLE device_tokens (
  id           uuid PRIMARY KEY,              -- uuidv7
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token        text NOT NULL UNIQUE,          -- APNs device token, hex
  platform     text NOT NULL,                 -- 'ios' (macOS later)
  environment  text NOT NULL,                 -- 'sandbox' | 'production'
  bundle_id    text NOT NULL,                 -- APNs topic
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  disabled_at  timestamptz                    -- set on APNs 410 Unregistered
);
CREATE INDEX device_tokens_user_idx ON device_tokens (user_id) WHERE disabled_at IS NULL;
```

`token` is globally unique, not unique per user: a phone handed to someone
else re-registers the same token under the new user, and the upsert must
**rebind** it (`ON CONFLICT (token) DO UPDATE SET user_id = …`), never
duplicate. That is the whole reason the unique constraint is on the token
alone.

REST, both `requireAuth`:

- `POST /v1/me/devices` `{token, platform, environment, bundleId}` — upsert +
  touch `last_seen_at`. Called on every launch, not just on token change:
  APNs tokens rotate silently (restore from backup, app reinstall) and the
  cheapest correctness policy is "register every cold start".
- `DELETE /v1/me/devices/:token` — sign-out. Must fire *before* the session
  token is discarded, or the row leaks and the next owner of that phone gets
  someone else's pushes until APNs 410s it.

Purge alongside the existing tombstone work when a user is deleted (the FK
cascade covers it).

### 2. The sender seam

Mirror `email/index.ts` and `storage/` exactly — an interface with a dev
driver and a real driver, chosen by config:

```ts
export interface PushSender {
  send(device: DeviceRow, payload: ApnsPayload, opts: ApnsHeaders): Promise<PushResult>;
}
```

- `dev` driver: logs and drops a JSON file in `.push/`, same as `DevMailer`.
  This is what CI and local QA run against — no Apple account needed, and the
  payload is inspectable.
- `apns` driver: `node:http2` to `api.push.apple.com` (or
  `api.sandbox.push.apple.com`), no dependency needed. Auth is a JWT
  (ES256, signed with the `.p8` APNs Auth Key) in `authorization: bearer …`.
  Apple requires the JWT be refreshed **between 20 and 60 minutes**; cache it
  ~55 min in module state and re-sign on demand. Keep one HTTP/2 session alive
  and multiplex — reconnect on `GOAWAY`.

Config, following the `FLOW_EMAIL_*` shape in `config.ts`:

| Env | Meaning |
|---|---|
| `FLOW_PUSH_DRIVER` | `dev` (default) \| `apns` |
| `FLOW_APNS_KEY` | base64 of the `.p8` APNs Auth Key |
| `FLOW_APNS_KEY_ID` | 10-char key id |
| `FLOW_APNS_TEAM_ID` | Apple Developer team id |
| `FLOW_APNS_TOPIC` | bundle id — `im.freeflow.app` |
| `FLOW_APNS_ENV` | `sandbox` \| `production` (per-device column wins) |

### 3. Delivery: outbox, not fire-and-forget

WS publish is loss-tolerant on purpose (clients backfill over REST). Push
isn't: a missed push is a notification the user never learns about, because
the phone has no socket to backfill from. So follow the Events API precedent
(decision log 2026-07-18, ruling 3) rather than the NATS one:

- `pending_push` rows written **in the same transaction** as the notification
  row — `insertNotifications` already has the `tx`, and `notifyReaction` can
  wrap its insert.
- An in-process worker drains them, started from `index.ts` next to
  `startAppEventsWorker`. At-least-once, survives restarts, retries with
  backoff. `services/appEvents.ts` is the model to copy, down to `MAX_ATTEMPTS`
  and the auto-disable-on-sustained-failure behaviour.

One enqueued row per *notification*, fanned out to that user's devices at send
time — not one row per device. Devices change between commit and delivery, and
the unread count (below) should be computed once per notification, not once
per device.

## The payload

Build it from the same strings the macOS banner already uses (`SyncEngine`'s
`.notification` case) so the three clients stay consistent:

```jsonc
{
  "aps": {
    "alert": {
      "title": "Alice mentioned you",
      "subtitle": "#alerts",       // which conversation (#460)
      "body": "standup in 5?"
    },
    "sound": "default",
    "badge": 7,                    // server-authoritative unread total
    "thread-id": "<channelId>"     // groups a channel's pushes in Notification Center
  },
  "workspaceId": "…", "channelId": "…", "messageId": "…",
  "threadRootId": "…",             // omitted for top-level
  "notificationId": "…"            // lets the tap mark exactly this row read
}
```

Headers: `apns-push-type: alert`, `apns-priority: 10`, `apns-topic: <bundle>`,
`apns-expiration` ~1 h (a two-hour-old "Bob is typing"-grade alert is noise),
and `apns-collapse-id` = channelId for kind 3, so a busy channel replaces
rather than stacks.

The custom keys are deliberately the **same contract the macOS banner's
`userInfo` already carries**, so tap-routing is the existing
`AppState.openNotification` path with a different entry point.

`subtitle` is the "where" row (#460): `#name` for a standard channel and the
other members' display names for a dm/group_dm — the same distinction
`channelTitle.ts` draws in the sidebar, and never a `#` in front of a person.
A thread reply needs no special case: the notification already carries the
channel the thread lives in. It is not on the body-preview switch below, since
it says where rather than what anyone wrote.

`badge` is the value #63 made cheap and authoritative: the unread count the
server already computes for `notification.read`. Reuse `unreadCount(userId)`
once per notification.

### Silent pushes keep the badge honest

The counterpart matters as much as the alert: when you read a mention on your
laptop, the phone in your pocket should drop its badge. `notification.read`
already fires with the fresh total — mirror it as a **background push**
(`apns-push-type: background`, `content-available: 1`, `apns-priority: 5`, no
alert) carrying just the count. iOS applies it in
`didReceiveRemoteNotification` without waking the UI.

Apple throttles background pushes (a few per hour, budget-based), so coalesce:
at most one badge-sync push per user per ~30 s, and skip it entirely when an
alert push for the same user is already going out with the current count.

## Client: iOS

1. **Entitlement + capability** — `aps-environment` (`development` in dev
   builds, `production` for TestFlight/App Store) in `project.yml`'s target
   entitlements. Needs a real Apple Developer team.
2. **Permission** — `Banners.requestPermissionIfNeeded` currently asks for
   `[.badge]` only; widen to `[.alert, .sound, .badge]`, keeping the existing
   `FLOW_DEBUG_*` bail-out so headless simulator QA never hits a system alert.
3. **Register** — `UIApplication.registerForRemoteNotifications()` after
   permission; `didRegisterForRemoteNotificationsWithDeviceToken` hex-encodes
   the token and POSTs `/v1/me/devices` through `SyncEngine`. Re-register on
   every launch and on `didChange` — see above.
4. **Foreground** — `willPresent` returns `[]` (suppress) when the payload's
   channel is the one on screen and no thread covers it; otherwise
   `[.banner, .sound]`. This is where the "don't banner what I'm reading" rule
   lives, matching web's `document.hidden` check and macOS's `activeChannelId`
   check.
5. **Tap** — `didReceive response` routes on the custom keys: select workspace
   → open channel → focus message (and push the thread screen once the iOS
   thread-route Parity gap is closed), then `markNotificationRead(id:)` with
   the payload's `notificationId`.
6. **Sign-out** — `DELETE /v1/me/devices/:token` before clearing the Keychain,
   and `UNUserNotificationCenter.removeAllDeliveredNotifications()`.

`apps/ios/Sources/Platform/Banners.swift` is where most of this lands; its
header comment already describes itself as a stub awaiting this phase.

### Testing without Apple infrastructure

`xcrun simctl push <device> im.freeflow.app payload.json` delivers a payload
straight to a simulator app — enough to verify rendering, grouping, badge
maths, foreground suppression and tap-routing end to end, which is the bulk of
the client work. The dev `PushSender` can write exactly that file format, so
the server's payload builder is tested by the same artifact.

What `simctl` can *not* test: token registration, JWT auth, APNs error codes,
delivery to a locked/backgrounded phone. Those need a physical device and a
real key — the physical-device setup in `IOS.md`. (Xcode 14+/iOS 16+
simulators on Apple silicon can register for remote notifications, but treat
that as a bonus, not the verification plan.)

## Token lifecycle and error handling

APNs is the authority on which tokens are alive:

| Response | Action |
|---|---|
| `410 Unregistered`, `400 BadDeviceToken` | set `disabled_at` — app uninstalled or token rotated. Never retry. |
| `403 InvalidProviderToken` | key/JWT wrong — log loudly, don't burn retries; this is an operator alarm, not a transient. |
| `429 TooManyRequests`, `5xx` | retry with backoff (worker's existing policy). |
| `400 BadCollapseId`/`PayloadTooLarge` | bug — log with the payload, drop. |

Payload cap is 4 KB (alert pushes); truncate `body` well below it — a preview,
not the message.

## Open questions for the operator

1. **Does the message body go in the payload?** Bodies are AES-GCM encrypted
   at rest (`crypto/index.ts`); putting plaintext in a push hands it to Apple's
   servers in transit. Three options, in ascending cost:
   (a) include it — what Slack does, best UX;
   (b) send "Alice sent you a message" with no body — no content leaves;
   (c) `mutable-content: 1` + a Notification Service Extension that fetches the
   body over the API with the device's own token — full UX, no content in the
   payload, but a new target and a second auth path on device.
   **Recommendation: (a) now, with (c) as the upgrade** if Flow ever hosts
   workspaces that care. Worth a decision-log ruling either way.
   **Answered 2026-09-01 (operator ruling, decision log): (a).** Built in #248
   behind `FLOW_PUSH_BODY_PREVIEW`, which defaults on and stays on — the flag
   is the one-line reversal to (b), not a knob.
2. **Apple Developer account** — team id, the APNs Auth Key (`.p8`, one per
   team, reusable across apps), and who holds it. Blocks everything past the
   dev driver.
3. **Sandbox vs production** — TestFlight builds use *production* APNs, which
   is a common first-deploy trap. The per-device `environment` column exists so
   both can be live at once; confirm we want that rather than a global switch.
4. **macOS too?** The same registry and sender work for the Mac app (it needs
   proper signing + provisioning first, which it doesn't have today). Local
   `UNUserNotificationCenter` banners cover the running-app case there, so
   this is only worth doing if we want alerts on a quit Mac app. Out of scope
   here.

## Suggested phasing

1. **Registry + seam + dev driver.** Table, REST, outbox, worker, payload
   builder, `simctl`-verified rendering and tap-routing on the simulator. No
   Apple account needed. This is most of the work.
2. **Real APNs.** Key, entitlement, physical-device verification, error-code
   handling, sandbox/production split.
3. **Polish.** Background badge-sync pushes, collapse ids, expiry tuning, and
   the notification-prefs UI on iOS (currently a Parity gap — the toggles exist
   server-side and would finally have an on-device consumer).
