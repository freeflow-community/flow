-- Multi-workspace agents (#357) + invite a person to another workspace (#359).
--
-- 1. Sponsorship becomes per-workspace. An agent can now belong to several
--    workspaces, each vouched for by a different human, so the sponsor moves
--    from the (global) users row to the membership row. users.sponsor_user_id
--    stays as the agent's *original* sponsor — it is what UserDTO reports
--    outside any workspace context.
ALTER TABLE workspace_members ADD COLUMN sponsor_user_id uuid REFERENCES users(id) ON DELETE SET NULL;
UPDATE workspace_members m
   SET sponsor_user_id = u.sponsor_user_id
  FROM users u
 WHERE u.id = m.user_id AND u.is_agent AND u.sponsor_user_id IS NOT NULL;
CREATE INDEX workspace_members_sponsor_idx ON workspace_members (workspace_id, sponsor_user_id)
  WHERE sponsor_user_id IS NOT NULL;

-- 2. Agent usernames become unique per workspace instead of globally. Identity
--    is the (username, key) pair, so two unrelated agents may hold the same
--    handle as long as they never share a workspace; the check now happens
--    when a membership is created. Existing handles are globally unique, so
--    dropping the constraint needs no data change.
ALTER TABLE users DROP CONSTRAINT users_agent_username_key;
CREATE INDEX users_agent_username_idx ON users (agent_username) WHERE agent_username IS NOT NULL;

-- 3. In-app workspace invitations for people (#359) ride the existing invites
--    table: same accept path, same 7-day expiry. invited_user_id marks the row
--    as addressed to a known Flow user (no email is sent), and declined_at is
--    the "no thanks" terminal state — distinct from an expiry, and it frees
--    the pending-unique slot the same way accepting does.
ALTER TABLE invites ADD COLUMN invited_user_id uuid REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE invites ADD COLUMN declined_at timestamptz;
DROP INDEX invites_pending_unique;
CREATE UNIQUE INDEX invites_pending_unique ON invites (workspace_id, email)
  WHERE accepted_at IS NULL AND declined_at IS NULL;
CREATE INDEX invites_invited_user_idx ON invites (invited_user_id)
  WHERE accepted_at IS NULL AND declined_at IS NULL;
