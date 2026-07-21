# Phase 1: MyChat Platform — a Slack clone

**Scope:** Self-register (email/password, no verification), workspaces, invites, channels, messages, threads. TypeScript backend on NATS (single node today, horizontal later). Native macOS client.

---

## 1. Architecture Overview

```
┌─────────────┐   HTTPS (REST)    ┌──────────────────────────────┐
│ macOS Client│◄─────────────────►│  API Service (Fastify + TS)  │
│  (SwiftUI)  │                   │  - auth, CRUD, message write │
└──────┬──────┘                   └──────┬───────────────────────┘
       │ WSS                             │ publish
       │                                 ▼
┌──────▼──────────────┐          ┌──────────────┐      ┌────────────┐
│  WS Gateway (TS)    │◄─────────│ NATS         │      │ PostgreSQL │
│  - socket sessions  │ subscribe│ (JetStream)  │      │ (source of │
│  - fan-out          │          └──────────────┘      │  truth)    │
└─────────────────────┘                                └────────────┘
```

Single node today: API service and WS Gateway run as **one Node process**, with NATS and Postgres as sidecar containers (docker-compose). The seam between them is NATS subjects, so splitting into separate processes/instances later is a deploy change, not a rewrite.

**Write path:** client → REST `POST /messages` → validate → insert into Postgres → publish event to NATS → gateway fans out to subscribed sockets (including sender, who reconciles by `client_msg_id`).

**Why write via REST, not WS:** simpler idempotency/retry semantics, uniform auth, and the WS channel stays a pure event feed. Typing indicators and presence (ephemeral, loss-tolerant) go over WS directly.

---

## 2. Data Model (PostgreSQL)

IDs: `UUIDv7` everywhere (time-ordered → indexes stay hot, messages sort by ID). Timestamps are `timestamptz`.

```sql
-- USERS ----------------------------------------------------------
CREATE TABLE users (
  id            uuid PRIMARY KEY,            -- uuidv7
  email         citext UNIQUE NOT NULL,
  password_hash text NOT NULL,               -- argon2id
  display_name  text NOT NULL,
  avatar_url    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Opaque bearer tokens (revocable; simpler than JWT for MVP)
CREATE TABLE sessions (
  token_hash  bytea PRIMARY KEY,             -- sha256 of random 32-byte token
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,          -- e.g. now() + 30 days, sliding
  client_info text                            -- "macOS 15.2 / v0.1.0"
);

-- WORKSPACES -----------------------------------------------------
CREATE TABLE workspaces (
  id          uuid PRIMARY KEY,
  slug        citext UNIQUE NOT NULL,        -- url-safe, immutable
  name        text NOT NULL,
  created_by  uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE member_role AS ENUM ('owner', 'admin', 'member');

CREATE TABLE workspace_members (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         member_role NOT NULL DEFAULT 'member',
  joined_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX ON workspace_members (user_id);   -- "my workspaces"

-- INVITES --------------------------------------------------------
CREATE TABLE invites (
  id           uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email        citext NOT NULL,
  token_hash   bytea UNIQUE NOT NULL,        -- invite link carries raw token
  invited_by   uuid NOT NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,         -- 7 days
  accepted_at  timestamptz,
  UNIQUE (workspace_id, email)               -- one pending invite per email
);

-- CHANNELS -------------------------------------------------------
CREATE TABLE channels (
  id           uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         citext NOT NULL,              -- lowercase, [a-z0-9-_]
  topic        text,
  is_private   boolean NOT NULL DEFAULT false,
  created_by   uuid NOT NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  archived_at  timestamptz,
  UNIQUE (workspace_id, name)
);

-- Membership doubles as read-state anchor
CREATE TABLE channel_members (
  channel_id        uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at         timestamptz NOT NULL DEFAULT now(),
  last_read_msg_id  uuid,                    -- uuidv7 → comparable to msg ids
  notify_level      smallint NOT NULL DEFAULT 1,  -- 0=mute 1=mentions 2=all
  PRIMARY KEY (channel_id, user_id)
);
CREATE INDEX ON channel_members (user_id);

-- MESSAGES & THREADS --------------------------------------------
CREATE TABLE messages (
  id             uuid PRIMARY KEY,           -- uuidv7 = ordering key
  channel_id     uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES users(id),
  thread_root_id uuid REFERENCES messages(id),  -- NULL = top-level
  client_msg_id  uuid NOT NULL,              -- idempotency + echo reconcile
  body           bytea NOT NULL,             -- ciphertext of markdown-ish source text
  body_nonce     bytea NOT NULL,             -- AES-GCM nonce
  enc_key_id     text NOT NULL,              -- data key that encrypted this row (rotation)
  enc_scheme     smallint NOT NULL DEFAULT 1,   -- 0=plaintext (dev only), 1=aes-256-gcm-v1
  created_at     timestamptz NOT NULL DEFAULT now(),
  edited_at      timestamptz,
  deleted_at     timestamptz,                -- soft delete, body overwritten with empty ciphertext
  -- denormalized thread rollup (only meaningful on root messages)
  reply_count    int NOT NULL DEFAULT 0,
  last_reply_at  timestamptz,
  UNIQUE (channel_id, client_msg_id)
);

-- channel history: top-level messages, newest first, cursor on id
CREATE INDEX msg_channel_top ON messages (channel_id, id DESC)
  WHERE thread_root_id IS NULL;
-- thread view: replies in order
CREATE INDEX msg_thread ON messages (thread_root_id, id)
  WHERE thread_root_id IS NOT NULL;
```

### Design notes

- **Threads are messages.** A reply is a row with `thread_root_id` set; no separate threads table. `reply_count` / `last_reply_at` are updated transactionally on the root row when a reply is inserted (single UPDATE, same txn). Replies must point at a root (`thread_root_id` of a reply is always the root, never another reply) — one level deep, like Slack.
- **Read state** lives on `channel_members.last_read_msg_id`. Because message IDs are UUIDv7 (time-ordered), unread count = `COUNT(*) WHERE channel_id = ? AND id > last_read_msg_id AND thread_root_id IS NULL`. Cheap at MVP scale; cache later.
- **Idempotency:** client generates `client_msg_id` per send; retries are deduped by the unique constraint, and the sender matches the WS echo back to its optimistic local row.
- **DMs** (post-MVP) are just channels with `kind = 'dm'` and a canonical member-pair key — the model already accommodates this; add a `kind` column when needed.
- **Encryption at rest (message bodies).** Message `body` is stored as AES-256-GCM ciphertext via envelope encryption: a data key (identified by `enc_key_id`) encrypts rows; the data key itself is stored wrapped by a KMS master key (AWS/GCP KMS in prod, a sealed key file for local dev) and never lives in Postgres. Encrypt/decrypt happens in one place — the message service — so a leaked `pg_dump`, SQL-injection row dump, or over-privileged DB user yields only ciphertext. `enc_key_id` enables rotation (new writes use the new key; old rows re-encrypted lazily or by backfill); `enc_scheme` versions the algorithm (`0` = plaintext, dev only). Nothing else queries `body` — pagination, unread counts, and threads are all ID/metadata-based — and server-side search is out of scope for phase 1, so no query pattern is lost. Other sensitive fields already store only hashes (passwords, session and invite tokens); remaining columns (emails, names, topics) stay plaintext because unique constraints and lookups depend on them.
- **Threat model note:** this protects stored data (stolen disks, leaked backups/snapshots, DB-level exfiltration), *not* a compromised live server or malicious admin — the server holds the keys and sees plaintext in memory. That stronger guarantee is E2EE, explicitly out of scope.

---

## 3. NATS Design

Core NATS for live fan-out; JetStream deferred until multi-node (Postgres is the source of truth, so we don't need broker persistence yet — a client that misses events backfills over REST on reconnect).

**Subject scheme** (workspace-scoped, wildcard-friendly):

```
ws.{workspaceId}.chan.{channelId}.msg        # message created/updated/deleted
ws.{workspaceId}.chan.{channelId}.typing     # ephemeral
ws.{workspaceId}.presence                    # user online/offline
ws.{workspaceId}.meta                        # channel created, member joined, etc.
```

**Gateway behavior:** on socket auth, the gateway looks up the user's workspaces + channel memberships and subscribes to the matching subjects (one subscription per workspace using wildcards: `ws.{id}.>`, then filters private channels per-socket against a membership set cached in memory and invalidated by `meta` events). Envelope:

```ts
interface Event<T> {
  type: 'message.created' | 'message.updated' | 'message.deleted'
      | 'thread.reply' | 'typing' | 'presence' | 'channel.created'
      | 'member.joined';
  workspaceId: string;
  channelId?: string;
  ts: string;        // ISO
  data: T;
}
```

**Encryption note:** events carry plaintext bodies — the API service decrypts before publishing, so the gateway and client never touch ciphertext. Core NATS is in-memory and inter-service traffic runs over TLS, so nothing persists unencrypted.

**Scaling seam:** when we go multi-node, WS gateways become a horizontally scaled pool, all subscribing to NATS; the API tier scales independently; JetStream gets enabled on the `msg` subjects if we want replay/at-least-once between services. Nothing in the client or data model changes. (JetStream persists streams to disk — when enabled, its storage needs the same volume encryption as Postgres, or JetStream's built-in encryption at rest.)

---

## 4. Backend Service (TypeScript)

- **Runtime:** Node 22, TypeScript strict. **Fastify** for HTTP, `ws` for WebSocket, `nats` client, **Drizzle ORM** + `postgres` driver (Drizzle keeps the schema in TS and generates migrations; swap for Kysely if you prefer query-builder-only).
- **Layout (monorepo, pnpm workspaces):**

```
/packages
  /shared        # zod schemas + Event/DTO types (shared w/ codegen for Swift)
  /server        # Fastify app: routes/, services/, db/, gateway/
  /infra         # docker-compose: postgres, nats
```

- **Auth:** argon2id password hashing; login issues a random 32-byte token (returned once, stored hashed). `Authorization: Bearer <token>` on REST; same token in the WS `auth` frame. Sliding 30-day expiry.
- **Validation:** zod schemas on every route, shared with the client via generated Swift types (quicktype or manual mirror at MVP).
- **Encryption at rest:** a `crypto/` module in `/server` owns envelope encryption of message bodies (see §2 design notes): Node's built-in `crypto` for AES-256-GCM, data key unwrapped once at boot via KMS (or `MYCHAT_DATA_KEY` sealed file in dev) and held only in memory. Only the message service calls it; routes, gateway, and client see plaintext DTOs unchanged. Infra baseline regardless: encrypted volumes for Postgres and encrypted backups (cloud-provider default, or LUKS/FileVault self-hosted).

### REST API surface

```
POST   /v1/auth/register            {email, password, displayName}
POST   /v1/auth/login               {email, password} → {token, user}
POST   /v1/auth/logout

GET    /v1/me
GET    /v1/me/workspaces

POST   /v1/workspaces               {name, slug}          → creator becomes owner,
                                                            #general auto-created
GET    /v1/workspaces/:id
POST   /v1/workspaces/:id/invites   {email}               → {inviteUrl}
POST   /v1/invites/accept           {token}               → joins workspace
GET    /v1/workspaces/:id/members

POST   /v1/workspaces/:id/channels  {name, topic?, isPrivate?}
GET    /v1/workspaces/:id/channels                        → joined + public
POST   /v1/channels/:id/join
GET    /v1/channels/:id/messages    ?before=<msgId>&limit=50   (cursor pagination)
POST   /v1/channels/:id/messages    {clientMsgId, body, threadRootId?}
PATCH  /v1/messages/:id             {body}
DELETE /v1/messages/:id
GET    /v1/messages/:id/thread      ?after=<msgId>&limit=50
POST   /v1/channels/:id/read        {lastReadMsgId}
```

**Permissions (MVP):** must be a workspace member to see it; must be a channel member to read/post private channels; public channels readable by any workspace member, auto-join on first post; only author edits/deletes own messages; owner/admin can create invites.

### WS protocol

```
client → server:  {op: "auth", token}
                  {op: "typing", channelId}
server → client:  {op: "hello", sessionId}        # after auth
                  {op: "event", event: Event<T>}
                  {op: "ping"} / client {op: "pong"}   # 30s heartbeat
```

Reconnect: client reconnects with backoff, then backfills each visible channel via `GET /messages?before=...` against its newest local message ID. No server-side resume state needed at MVP.

---

## 5. macOS Client

- **Stack:** Swift 6 / SwiftUI, macOS 14+. `URLSession` for REST + `URLSessionWebSocketTask` for WS. **GRDB (SQLite)** local cache so channels render instantly and survive offline. Token in **Keychain**.
- **Architecture:** thin MVVM over an actor-based `SyncEngine`:
  - `APIClient` (REST) and `SocketClient` (WS) feed the `SyncEngine`
  - `SyncEngine` owns GRDB writes; views observe GRDB via `ValueObservation`
  - Optimistic send: insert local row with `clientMsgId` + `pending` flag → POST → reconcile on WS echo or response
- **Screens (MVP):**
  1. Sign in / register
  2. Workspace switcher (+ create workspace, accept invite via `myapp://invite/<token>` deep link)
  3. Main window: sidebar (channels, unread badges) • message list (grouped by author/time) • composer
  4. Thread panel (right-hand split, Slack-style)
  5. Invite sheet (enter email → copy invite link; no email sending at MVP)
- **Rendering:** message list virtualized with `List` + stable UUIDv7 sort; markdown via `AttributedString(markdown:)` for MVP.
- **Local cache at rest:** the GRDB cache holds plaintext messages on disk; FileVault (default on modern macOS) covers it for MVP. Upgrade path: SQLCipher with a Keychain-held key if we want the app to guarantee it rather than the OS.

---

## 6. Phase 1 Cut Lines

**In:** register/login, workspaces, invites (link-based, no email delivery), public+private channels, messages, one-level threads, edits/deletes, unread counts, typing, presence, optimistic send, offline read cache, encryption at rest for message bodies (envelope encryption) + encrypted volumes/backups.

**Out (explicitly):** DMs, reactions, file uploads, search, notifications/push, email sending, mobile/web clients, JetStream, multi-node, E2EE (at-rest encryption only; see §2 threat model note), key-rotation backfill tooling (rotation supported by `enc_key_id`, tooling later).

**Deployment** Local server only

**Build order:**
1. Infra + schema + auth (register/login/sessions)
2. Workspaces, invites, channels (REST only, test via curl)
3. Messages + threads REST with cursor pagination (incl. `crypto/` module — envelope encryption of bodies from day one)
4. NATS publish + WS gateway + heartbeat/reconnect
5. Mac client: auth → channel list → message list → composer w/ optimistic send
6. Threads panel, unread state, typing/presence



