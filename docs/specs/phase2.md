# Phase 2: DMs, Reactions, Files, Mentions, Web Client

**Scope:** DMs (1:1 and group), emoji reactions, file uploads *and previews*, @-mentions with notifications, emoji support in the composer, channel membership management (invite-to-channel — required for private channels to be usable), user profile editing (display name, timezone, avatar), web client. Still a single local server.

**Deployment:** Local server only (docker-compose from phase 1, plus a local file-storage directory).

---

## 1. DMs (one-to-one and group)

DMs reuse the channel machinery, as anticipated in phase 1's design notes.

```sql
CREATE TYPE channel_kind AS ENUM ('standard', 'dm', 'group_dm');

ALTER TABLE channels
  ADD COLUMN kind    channel_kind NOT NULL DEFAULT 'standard',
  ADD COLUMN dm_key  text,          -- canonical member key, see below
  ALTER COLUMN name DROP NOT NULL;  -- dm/group_dm channels have no name

-- one DM channel per member set per workspace
CREATE UNIQUE INDEX chan_dm_key ON channels (workspace_id, dm_key)
  WHERE dm_key IS NOT NULL;
```

- **`dm_key`** = the sorted member user IDs joined with `:` (works for 1:1 and group). `POST /v1/workspaces/:id/dms {userIds}` is an upsert: compute the key, return the existing channel or create it. No duplicate DM channels, no race (unique index wins).
- **Rules:** `is_private` is always true for DMs; membership is fixed at creation for 1:1; group DMs allow adding a member, which (like Slack) *creates a new group DM* with the wider member set rather than mutating the old one. Nobody can join or be invited via the normal channel endpoints; leave is allowed for group DMs only.
- **Sidebar:** client renders DM channels by member display names, not `name`. Unread/read-state, threads, typing, and presence all work unchanged because DMs are channels.

---

## 2. Reactions

```sql
CREATE TABLE reactions (
  message_id  uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji       text NOT NULL,        -- unicode emoji (e.g. "👍"); no custom emoji at this phase
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji)
);
CREATE INDEX ON reactions (message_id);
```

```
PUT    /v1/messages/:id/reactions/:emoji     # idempotent add
DELETE /v1/messages/:id/reactions/:emoji     # idempotent remove
```

- Events `reaction.added` / `reaction.removed` on the channel's `msg` subject.
- Message DTOs carry an aggregated `reactions: [{emoji, count, userIds}]`; computed per page fetch (one grouped query per message page, join on the page's message IDs).
- Emoji are plain unicode — no `:shortcode:` storage, no custom emoji table yet. The picker (client) maps shortcodes to unicode before sending.

---

## 3. Files: uploads and previews

Storage is a local directory in phase 2 (`MYCHAT_FILE_DIR`), fronted by the API service; the storage layer is a small interface (`put/get/delete` by key) so phase 3 can swap in object storage without touching routes.

```sql
CREATE TABLE files (
  id           uuid PRIMARY KEY,             -- uuidv7
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id),
  name         text NOT NULL,                -- original filename
  mime_type    text NOT NULL,
  size_bytes   bigint NOT NULL,
  storage_key  text NOT NULL,                -- opaque key in the blob store
  enc_key_id   text NOT NULL,                -- same envelope-encryption scheme as messages
  width        int,                          -- images only
  height       int,
  thumb_key    text,                         -- storage key of generated thumbnail, if any
  created_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);

-- attachment link; a message can carry multiple files
CREATE TABLE message_files (
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  file_id    uuid NOT NULL REFERENCES files(id),
  PRIMARY KEY (message_id, file_id)
);
```

```
POST   /v1/workspaces/:id/files       multipart upload → {fileId, name, mime, size}
GET    /v1/files/:id                  → bytes (auth-checked, streamed, decrypted)
GET    /v1/files/:id/thumb            → thumbnail bytes (images only)
POST   /v1/channels/:id/messages      body gains optional fileIds: [uuid]
```

- **Flow:** upload first (returns `fileId`s), then send the message referencing them — matches optimistic send (upload progress shows on the pending message). Orphaned files (uploaded, never attached for 24h) are swept by a boot-time / daily in-process check — no scheduler infrastructure.
- **Previews:** on upload, images (`image/png|jpeg|gif|webp`) get a max-512px thumbnail generated with `sharp` and dimensions recorded; clients render image attachments inline (thumb, click for full). Everything else renders as an icon + name + size card. PDF/video previews are out of scope this phase.
- **Encryption at rest:** file blobs and thumbnails are AES-256-GCM-encrypted with the same envelope scheme and data key registry as message bodies (`enc_key_id` per file; nonce prepended to the blob). The storage layer only ever sees ciphertext. Same threat model as phase 1: protects stored data, not a compromised live server.
- **Limits:** 20 MB/file, 10 files/message (rate limiting arrives with the rest in phase 3). `Content-Disposition: attachment` + `X-Content-Type-Options: nosniff` on downloads (don't let uploaded HTML execute on our origin).

---

## 4. Mentions and notifications

> **Superseded — historical.** This is the phase-2 proposal. The system has
> since gained group mentions, `notify_level=all` rows, the `suppressAlert`
> gate (phase 10), the Activity feed (phase 12), reaction notifications and
> read-on-visit (#63). The schema block below is out of date (no `subkind`,
> `actor_id` or `reaction_emoji`; kinds 3 and 4 missing) and the delivery
> subject was later changed to the user-global `user.{userId}.notify`.
> **Current behaviour: `docs/design/NOTIFICATIONS.md`.**

**Parse at write time, server-side.** The message service extracts `@display_name` tokens (client sends resolved `mentions: [userId]` alongside the body; server validates each is a workspace member — no fuzzy server-side name matching).

```sql
CREATE TABLE notifications (
  id          uuid PRIMARY KEY,              -- uuidv7
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id  uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  channel_id  uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  kind        smallint NOT NULL,             -- 0=mention 1=dm 2=thread_reply
  created_at  timestamptz NOT NULL DEFAULT now(),
  read_at     timestamptz
);
CREATE INDEX ON notifications (user_id, read_at, id DESC);
```

```
GET    /v1/me/notifications        ?before=<id>&limit=50
POST   /v1/me/notifications/read   {upToId}
```

- **What notifies:** @-mention (respecting `notify_level`: mute suppresses everything; `mentions` is the default; `all` also notifies every message in that channel), any DM message, replies in threads you've posted in. Notification rows are written in the same transaction as the message.
- **Delivery:** a `notification.created` event on a new per-user subject `ws.{workspaceId}.user.{userId}.notify`; the gateway subscribes per authenticated socket. The macOS client raises a banner via `UNUserNotificationCenter` (local notifications while the app runs — no APNs; remote push requires Apple infrastructure and a deployed server, revisit after phase 3). The web client uses the browser Notification API. Badge counts come from the unread notifications count.
- **Rendering:** mentions are stored in the body as `<@userId>` (Slack-style) and rendered as highlighted pills by clients; this also keeps rendering correct when a user renames themselves.

---

## 5. Channel membership management

Closes the phase-1 gap: private channels currently have no way to gain members.

```
POST   /v1/channels/:id/members          {userId}     # invite/add (member of channel for private; any ws member for public)
DELETE /v1/channels/:id/members/:userId               # remove (admin/owner, or self = leave)
POST   /v1/channels/:id/leave
POST   /v1/channels/:id/archive                       # admin/owner or creator; sets archived_at
```

- Events `member.joined` / `member.left` / `channel.archived` on the `meta` subject (gateway membership caches already invalidate on `meta`).
- Archived channels are read-only and hidden from the default sidebar list.

---

## 6. User profiles

```sql
ALTER TABLE users ADD COLUMN timezone text NOT NULL DEFAULT 'UTC';  -- IANA name
```

```
PATCH  /v1/me            {displayName?, timezone?}
POST   /v1/me/avatar     multipart image → stored via the files layer, avatar_url updated
GET    /v1/users/:id     → {id, displayName, avatarUrl, timezone, email}  (workspace co-members only)
```

- `user.updated` event on the `meta` subject of each workspace the user belongs to, so clients refresh names/avatars live.
- Avatars are square-cropped and resized to 512px on upload; served unencrypted-cacheable (they're not message content; `Cache-Control` with the file ID as immutable key).
- Profile popover in clients shows name, avatar, local time (from timezone), email.

---

## 7. Web client

- **Stack:** React 19 + TypeScript + Vite, Tailwind, TanStack Query for REST, a thin WS client mirroring the macOS `SocketClient`. Lives in the monorepo as `/packages/web` and imports the zod schemas and `Event` types from `/packages/shared` directly — the payoff of the shared package (no Swift-style codegen needed).
- **Auth:** same bearer token, held in memory + `localStorage`. Same WS `auth` frame.
- **Persistence:** none in v1 — the web client is online-only (no IndexedDB message cache yet); on load it fetches, on reconnect it backfills exactly like the macOS client's reconnect path.
- **Screens:** mirrors the macOS MVP set — sign-in/register, workspace switcher, main three-pane window, thread panel, invite sheet — plus everything added this phase (DM list, reactions, file upload/preview, notification list, profile editing, emoji picker).
- **Serving:** Vite dev server locally; production build served as static files by Fastify (`@fastify/static`) so the local deployment stays one process.

---

## 8. Composer emoji support (both clients)

- Emoji picker (grid + search) inserting unicode; `:shortcode:` autocompletion in the composer expands to unicode before send. Bodies store plain unicode — no server involvement, no schema change.

---

## 9. Phase 2 Cut Lines

**In:** 1:1 DMs, group DMs, reactions (unicode), file upload + image previews/thumbnails (encrypted at rest), mentions + notifications (in-app + local OS notifications), channel member add/remove/leave/archive, profile editing (name, timezone, avatar), emoji picker + shortcodes, web client (online-only).

**Out (explicitly):** custom emoji, PDF/video previews, remote push (APNs/web push), email delivery of anything, message search (excluded by overview), web client offline cache, JetStream and multi-node (scale-triggered — see phase 4 Appendix A; decision log 2026-07-18), Slack API compatibility (phase 4), drafts/canvas/huddles (excluded by overview).

**Build order:**
1. Channel `kind` migration + DM upsert endpoint + sidebar rendering (both platforms' groundwork is phase-1 code)
2. Reactions (schema, endpoints, events, UI)
3. Files: storage layer + encrypted blobs + upload/download routes + thumbnails; wire into composer/message list
4. Channel membership endpoints + archive; private-channel invite UI
5. Profiles: timezone column, PATCH /me, avatar upload
6. Mentions + notifications (schema, per-user subject, gateway subscription, OS banners, badge counts)
7. Web client (bring-up against the finished API, then feature parity)
