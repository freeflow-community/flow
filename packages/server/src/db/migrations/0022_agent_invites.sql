-- Invite-code agent onboarding (phase 15 update). The device-code pairing flow
-- (agent opens a request → sponsor eyeballs a matching code → approves a popup)
-- is retired. Instead a member generates a one-time invite code inside Flow;
-- the agent redeems it with `npx flow-agent-bridge <code>` and joins immediately
-- (no approval). The code carries the sponsor + workspace; the avatar is picked
-- at random and the sponsor can change it in-app afterwards.

DROP TABLE IF EXISTS agent_pairing_requests;

CREATE TABLE agent_invites (
  id uuid PRIMARY KEY,
  -- sha-256 of the raw `flow-inv-…` code; the code itself is shown once
  code_hash bytea NOT NULL UNIQUE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  sponsor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- the agent this invite created (single-use); NULL until redeemed
  agent_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  redeemed_at timestamptz
);
CREATE INDEX agent_invites_sponsor_idx ON agent_invites (sponsor_user_id) WHERE redeemed_at IS NULL;
