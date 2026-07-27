-- Persistent, revocable "join workspace" links (issue #85). Slack-style: one
-- live link per workspace at a time, good until an admin regenerates or
-- revokes it. Regenerating replaces the row (PK on workspace_id), which
-- instantly kills the old URL.
--
-- Unlike every other token in the schema we store the token in PLAINTEXT, not
-- a hash: the whole point is that an admin can reopen the dialog next month
-- and copy the same link again, which a one-way hash makes impossible. The
-- token grants exactly one capability — become a member of this workspace —
-- and is revocable in one click, so it is closer to a shared URL than to a
-- credential. Access to read it is owner/admin only, same as sending invites.

CREATE TABLE workspace_join_links (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  -- raw base64url token; the shared URL is /join/<workspace slug>/<token>
  token text NOT NULL UNIQUE,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
