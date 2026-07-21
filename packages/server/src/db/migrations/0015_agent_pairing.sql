-- On-demand agent registration with human sponsors (AGENT_MEMBERS.md).
-- Agents register like people: durable username + key credentials, and a
-- sponsor (the human member who approves the pairing code and is responsible
-- for the agent). The pre-registration invite flow is retired.

ALTER TABLE users ADD COLUMN sponsor_user_id uuid REFERENCES users(id);
ALTER TABLE users ADD COLUMN agent_username citext UNIQUE;
ALTER TABLE users ADD COLUMN agent_key_hash text;

CREATE TABLE agent_pairing_requests (
  id uuid PRIMARY KEY,
  username citext NOT NULL,
  key_hash text NOT NULL,
  name text NOT NULL,
  description text,
  avatar_url text,
  -- NULL when sponsor_email matched no account (anti-enumeration: the request
  -- is accepted anyway and just expires unapproved)
  sponsor_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  code text NOT NULL,
  poll_secret_hash bytea NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending', -- pending | approved | denied
  workspace_id uuid REFERENCES workspaces(id) ON DELETE SET NULL,
  agent_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  token_delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX agent_pairing_sponsor_idx ON agent_pairing_requests (sponsor_user_id) WHERE status = 'pending';

DROP TABLE agent_invites;
