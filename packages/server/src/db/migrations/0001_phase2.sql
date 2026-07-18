-- Phase 2: DMs, reactions, files, notifications, profiles (phase2.md §1-§6)

-- ---- DMs (§1): DMs reuse the channel machinery -------------------
CREATE TYPE channel_kind AS ENUM ('standard', 'dm', 'group_dm');

ALTER TABLE channels
  ADD COLUMN kind   channel_kind NOT NULL DEFAULT 'standard',
  ADD COLUMN dm_key text,                  -- sorted member user ids joined with ':'
  ALTER COLUMN name DROP NOT NULL;         -- dm/group_dm channels have no name

-- one DM channel per member set per workspace (upsert races resolved by this index)
CREATE UNIQUE INDEX chan_dm_key ON channels (workspace_id, dm_key)
  WHERE dm_key IS NOT NULL;

-- ---- Reactions (§2) ----------------------------------------------
CREATE TABLE reactions (
  message_id  uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji       text NOT NULL,               -- unicode emoji (e.g. "👍"); no custom emoji this phase
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji)
);
CREATE INDEX reactions_message_idx ON reactions (message_id);

-- ---- Files (§3) --------------------------------------------------
CREATE TABLE files (
  id           uuid PRIMARY KEY,           -- uuidv7
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id),
  name         text NOT NULL,              -- original filename
  mime_type    text NOT NULL,
  size_bytes   bigint NOT NULL,
  storage_key  text NOT NULL,              -- opaque key in the blob store
  enc_key_id   text NOT NULL,              -- same envelope-encryption scheme as messages
  width        int,                        -- images only
  height       int,
  thumb_key    text,                       -- storage key of generated thumbnail, if any
  created_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);

-- attachment link; a message can carry multiple files
CREATE TABLE message_files (
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  file_id    uuid NOT NULL REFERENCES files(id),
  PRIMARY KEY (message_id, file_id)
);
CREATE INDEX message_files_file_idx ON message_files (file_id);

-- ---- Notifications (§4) ------------------------------------------
CREATE TABLE notifications (
  id          uuid PRIMARY KEY,            -- uuidv7
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id  uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  channel_id  uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  kind        smallint NOT NULL,           -- 0=mention 1=dm 2=thread_reply 3=channel activity (notify_level=all)
  created_at  timestamptz NOT NULL DEFAULT now(),
  read_at     timestamptz
);
CREATE INDEX notifications_user_idx ON notifications (user_id, read_at, id DESC);

-- ---- Profiles (§6) -----------------------------------------------
ALTER TABLE users ADD COLUMN timezone text NOT NULL DEFAULT 'UTC';  -- IANA name
