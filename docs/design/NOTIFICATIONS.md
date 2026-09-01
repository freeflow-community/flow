# Notifications

How Flow decides that something needs your attention, tells you about it, and
decides you've seen it. This describes the system **as it behaves today** —
`docs/specs/phase2.md` §4, `phase10.md` and `phase12.md` are the original
proposals and have drifted; where they disagree, this document wins.

Push notifications to a phone whose app isn't running are the one piece not
built: `docs/design/PUSH_APNS.md`.

## The two questions

Every unread signal in Flow answers exactly one of these, and never both:

| Question | Signal | Source |
|---|---|---|
| Is there anything new in here? | the sidebar row is **bold** | `ChannelDTO.unreadCount` — unread *messages* |
| How many things need me? | a **number** | `ChannelDTO.unreadNotifications` — unread *notification rows* |

The number means the same thing everywhere it appears: on a channel row, on
the Activity row (the total), and on the dock / app-icon badge. Within one
workspace, per-channel counts sum across the channels you're in to that
workspace's share of the total — the test suite asserts it, and leaving or
archiving a channel retires its unread rows precisely so this invariant can't
drift (see Read state). The Activity row and the app badge are user-global:
with several workspaces they show the sum over all of them.

Keeping these separate is an operator ruling (decision_log 2026-07-26). Before
it, a channel showed "12" because twelve people had talked in it, so the same
glyph meant "you were mentioned" on one row and "a conversation happened" on
the next — which teaches you to ignore the number.

## What raises a notification

One row per `(user, message)` for kinds 0-3; reactions (kind 4) are counted
per `(user, message, actor, emoji)`. Rows are written **in the same
transaction as the message**, so a message and its notifications commit
together or not at all.

| kind | Raised by | Recipients |
|---|---|---|
| 0 | `@mention` | The mentioned users. `subkind` records which flavour: `mention` (a direct `<@user>`), `channel` (`<!channel>`/`<!everyone>` → every channel member), `here` (`<!here>` → currently-online members only). |
| 1 | any message in a DM or group DM | every *other* member |
| 2 | a thread reply | prior participants in that thread (root author + earlier repliers) who are still channel members |
| 3 | any message in the channel | only members who set that channel to **All messages** (`notify_level = 2`) |
| 4 | a reaction on your own message | the message author |

When one message qualifies a user several ways, precedence is
**dm > mention > thread_reply > activity**, and a direct mention beats a group
mention within the same message. Reactions are independent — they attach to a
message you already own, so they never compete.

### What deliberately does *not* notify

- **A plain message in a channel you're in.** It emboldens the row; that's all.
  Kind 3 exists only if you opted that channel into "All messages".
- **Your own personal DM.** The only member is you, and you are never your own
  recipient — a note to self is silent by construction.
- **Anything you did yourself**: your own messages, your own reactions.
- **A muted channel** (`notify_level = 0`) — suppresses everything, *including
  DMs*. Mute is absolute.
- **A reaction re-added after being removed.** React → unreact → react notifies
  once. A partial unique index on `(user_id, message_id, actor_id,
  reaction_emoji) WHERE kind = 4` guarantees it, which also means an old row
  you already read can never resurrect as unread.
- **Mentions of a non-member in a private channel** — no membership leak.

A removed reaction *keeps* its row: it records "Bob reacted at 10:04", the same
way a later-deleted message keeps its mention.

## Alerts vs the inbox

**Rows are always written, whatever your preferences say.** Preferences gate
*OS banners only* — the Activity feed stays a complete record. This split is
the phase-10 design and it's what makes the same gate reusable for APNs later.

The server computes `suppressAlert` per recipient at fan-out *and* at REST list
time, so the decision travels with the notification and every client agrees
without implementing the policy itself:

```
suppressAlert = kind == 3                       // channel activity never alerts
             || user.status_suppress_alerts     // a DND-family status wins over everything
             || prefs[key] === false            // the matching per-user toggle
```

`key` is `dm` (1), `threadReply` (2), `reaction` (4), `groupMention` (0 with
subkind `here`/`channel`), else `mention`. Absent pref = on. `persistentBanners`
is presentation-only (web: keep the banner up until dismissed).

Clients add one local rule the server can't know: **"looking at it" means the
row is actually on screen.** All three conditions, on every client:

1. that channel is selected;
2. the app/tab is visible — `document.hidden` on web, `scenePhase`-driven
   `AppState.isViewing(channelId:)` natively. A selected channel in a
   backgrounded window or hidden tab is **not** seen; getting that wrong
   swallowed DMs entirely (fixed 2026-07-26);
3. if the notification's message lives in a thread — a reply, a mention in a
   reply, a reaction on your reply — that thread is open. Threads are behind a
   click, the same scoping the server's channel-read path uses.

Only then does the arriving row get marked read (and the banner skipped);
otherwise it badges and banners like any other. The mark-read-on-view effects
carry the same visibility guard and catch up when the tab or app comes back
to the front.

## Read state

A notification goes read through any of these paths. All of them converge on
the same rule: *you can only have read it if you were somewhere it was
visible.*

| Path | Endpoint | Scope |
|---|---|---|
| Opening the Activity feed | `POST /v1/me/notifications/read {upToId}` | everything at or before the newest row |
| Clicking one Activity row | `POST /v1/me/notifications/read {id}` | that row only |
| Visiting the channel | `POST /v1/channels/:id/read {lastReadMsgId}` | that channel's rows for **top-level** messages at or before the cursor |
| Opening a thread | `POST /v1/channels/:id/read {lastReadMsgId, threadRootId}` | that thread's rows (root + replies); the channel cursor is untouched |
| It arrives while you're looking | client marks the single row read | a reaction moves no read cursor, so without this it would linger. "Looking" is strict — see below |
| Leaving / being removed from a channel | server-side, in the removal path | all of that user's rows there — they could never clear by visiting again |
| The channel is archived | server-side, in the archive path | every member's rows there — an archived channel leaves the sidebar, so they'd count in Activity forever |

Losing-access rows are marked **read, never deleted** — the inbox stays a
complete record; only the unread signal is retired.

Threads are scoped separately on purpose: the channel's read cursor only tracks
top-level messages, so a reply lives behind a click and reading the channel
must not clear it.

Every read path publishes `notification.read` on the per-user subject with the
**fresh unread total**, so every signed-in session's badge converges on the
server's number instead of doing local arithmetic. A no-op read (the common
case — a read-cursor bump with nothing unread) publishes nothing and skips the
count query.

## Wire

Both events ride the per-user subject `user.{userId}.notify`, which the gateway
forwards to every authenticated socket of that user with no channel filter.
(User-global rather than workspace-scoped: approved deviation, decision log
2026-07-18.)

```
notification.created  → NotificationDTO   (the full row, with its message)
notification.read     → { ids, unreadCount, readAt }
```

`notification.read` carries `workspaceId: ''` when the rows can span workspaces
(the Activity-feed cursor) and the real id when the read was channel- or
thread-scoped.

REST:

```
GET  /v1/me/notifications ?before=<id>&limit=50   → { notifications, hasMore, unreadCount }
POST /v1/me/notifications/read {upToId} | {id}    → { ok, unreadCount }
POST /v1/channels/:id/read {lastReadMsgId, threadRootId?}
```

## Storage

```sql
CREATE TABLE notifications (
  id             uuid PRIMARY KEY,            -- uuidv7
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id     uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  channel_id     uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  kind           smallint NOT NULL,           -- 0..4, see the table above
  subkind        text,                        -- kind 0: 'mention' | 'here' | 'channel'
  actor_id       uuid REFERENCES users(id) ON DELETE CASCADE,  -- reactor (4) or author (0-3)
  reaction_emoji text,                        -- kind 4 only
  created_at     timestamptz NOT NULL DEFAULT now(),
  read_at        timestamptz
);
CREATE INDEX notifications_user_idx ON notifications (user_id, read_at, id DESC);
CREATE INDEX notifications_unread_channel_idx ON notifications (user_id, channel_id) WHERE read_at IS NULL;
CREATE UNIQUE INDEX notifications_reaction_uniq
  ON notifications (user_id, message_id, actor_id, reaction_emoji) WHERE kind = 4;
```

`actor_id` is nullable only for rows written before the column existed
(migration 0024 backfilled them from `messages.user_id`); readers fall back to
the message author. The unread-per-channel index is what makes both the sidebar
badge query and the read-on-visit update cheap.

Per-user preference state lives on `users`: `notification_prefs` (JSONB, `{}` =
all on) and `status_suppress_alerts` (boolean, set by DND-family statuses).

## Where the code is

| | |
|---|---|
| Recipients, alert gate, read paths, reaction rows | `packages/server/src/services/notifications.ts` |
| Writes rows inside the message transaction | `services/messages.ts` → `insertNotifications` |
| Reaction fan-out (post-commit, never fails the reaction) | `services/reactions.ts` → `notifyReaction` |
| Read-on-visit, per-channel badge count | `services/channels.ts` → `markRead`, `listChannels` |
| Web feed / badge / banners | `packages/web/src/components/ActivityView.tsx`, `Sidebar.tsx`, `Main.tsx` |
| Native feed / badge / banners | `apps/*/…/ActivityFeedView.swift`, `SidebarView.swift`, `Sync/SyncEngine.swift`, `Support/Banners.swift` |
| Tests | `packages/server/test/notifications.test.ts`, `scripts/notify-e2e.mjs` (one assertion per behaviour, against a running server) |

## Per-client state

| | web | macOS | iOS |
|---|---|---|---|
| Activity feed | ✅ | ✅ | ✅ (no thread route from a row — Parity) |
| Sidebar badge = notifications | ✅ | ✅ | ✅ |
| App badge | — | dock (needs the `.app` bundle; bare `swift run` is a no-op) | app icon |
| OS banners | Notification API | `UNUserNotificationCenter`, honours `suppressAlert` | **none** — awaits APNs |
| Preference UI | ✅ all toggles | ✅ in My Profile (#464) | ✅ Settings ▸ Notifications (#251) |
| Push when the app isn't running | n/a | n/a | ❌ `PUSH_APNS.md` |

Prefs are per-user and server-enforced, so all three clients read and write the
same object: a flip on any one of them silences the other two. The one key that
isn't universal is `persistentBanners` — web-only, because on macOS and iOS
whether an alert stays on screen is an OS setting no app can override. It
round-trips untouched through the native clients rather than being dropped.

## Open threads

- **iOS APNs** — the last real gap. `PUSH_APNS.md` has the design; phase 1 of
  it needs no Apple account.
- **`scenePhase` is an approximation.** A macOS window that is frontmost but
  fully covered still reports `.active`, so we may treat a hidden-behind-another
  -window channel as seen. The same approximation the web makes with
  `document.hidden`; it errs toward notifying rather than swallowing.
- **A channel you can see but haven't joined gives no signal at all** — no bold,
  no number. Slack's answer is a small dot for "unread, nothing for you".
