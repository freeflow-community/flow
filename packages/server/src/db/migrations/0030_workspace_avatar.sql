-- Workspace avatar (#336): an optional image mark shown wherever a workspace
-- is identified today (rail, switcher, chooser). Stored the same way user
-- avatars are — a path into the existing `/v1/avatars/:key` blob route — so
-- every client renders it through the authenticated image loader it already
-- has, and no avatar simply means the color/initial mark, exactly as before.
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS avatar_url text;
