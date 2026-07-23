-- Phase 13: artifacts flip from personal per-user bookmarks to per-channel
-- shared objects (operator ruling 2026-07-23, superseding the phase-9 rulings).
-- Existing per-user bookmarks have no channel to map to and are discarded
-- (operator decision). New shape: channel-scoped, with a mutable backing file
-- (agents "update" an artifact by re-pointing it at a freshly uploaded file)
-- and an owns_file flag so deleting an owned artifact can reap its file.
DROP TABLE IF EXISTS artifacts;
CREATE TABLE artifacts (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  channel_id   uuid NOT NULL REFERENCES channels(id)   ON DELETE CASCADE,
  file_id      uuid NOT NULL REFERENCES files(id)       ON DELETE CASCADE,
  owns_file    boolean NOT NULL DEFAULT false, -- artifact created its own file (agent upload)
  name         text NOT NULL,
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX artifacts_channel_idx ON artifacts (channel_id, created_at DESC);
-- pins of a shared file are idempotent per channel; owned (agent) artifacts are
-- always distinct rows (their file_id changes on every update)
CREATE UNIQUE INDEX artifacts_channel_file_pin ON artifacts (channel_id, file_id) WHERE owns_file = false;
