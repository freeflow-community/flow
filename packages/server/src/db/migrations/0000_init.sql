-- Phase 1 schema, faithful to phase1.md §2
CREATE EXTENSION IF NOT EXISTS citext;

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
  expires_at  timestamptz NOT NULL,          -- now() + 30 days, sliding
  client_info text
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
