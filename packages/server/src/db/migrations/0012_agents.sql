-- First-class AI agents (AGENTS_DESIGN.md): real users with is_agent=true,
-- invited by key instead of email, authenticated by non-expiring agent tokens.
ALTER TABLE users ADD COLUMN is_agent boolean NOT NULL DEFAULT false;

-- Single-use agent invites (key-based sibling of `invites`; raw key never stored).
CREATE TABLE agent_invites (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  name_hint text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  agent_user_id uuid REFERENCES users(id)
);
CREATE INDEX agent_invites_workspace_idx ON agent_invites (workspace_id);

-- Agent bearer tokens: non-expiring sibling of `sessions` (a daemon shouldn't
-- silently die); revoked_at is the kill switch.
CREATE TABLE agent_tokens (
  id uuid PRIMARY KEY,
  token_hash bytea NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX agent_tokens_user_idx ON agent_tokens (user_id);
