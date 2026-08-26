-- Custom emoji (#175): workspace-scoped images usable as reactions.
-- The image itself is an ordinary row in `files`, so uploads reuse the existing
-- presign flow and blob storage rather than a second upload path.
CREATE TABLE IF NOT EXISTS workspace_emoji (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- stored WITHOUT the surrounding colons; reactions store `:shortcode:`
  shortcode text NOT NULL,
  file_id uuid NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS workspace_emoji_code_idx
  ON workspace_emoji (workspace_id, shortcode);
