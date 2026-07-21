-- Phase 9: Artifact tabs — personal per-user bookmarks of shared files
-- (operator rulings 2026-07-21). Removing an artifact never touches the file.
CREATE TABLE artifacts (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  file_id uuid NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- one bookmark per (user, file); re-bookmarking is idempotent
CREATE UNIQUE INDEX artifacts_user_file_unique ON artifacts (user_id, file_id);
CREATE INDEX artifacts_user_ws_idx ON artifacts (user_id, workspace_id, created_at DESC);
