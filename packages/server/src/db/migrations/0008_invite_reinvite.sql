-- UNIQUE(workspace_id, email) was meant to be "one PENDING invite per email"
-- (see 0000_init.sql comment) but also counted accepted invites, so an email
-- could never be re-invited after its invite was used — e.g. a user whose
-- account was deleted and recreated. Accepted invites are history, not locks.
ALTER TABLE invites DROP CONSTRAINT invites_workspace_id_email_key;
CREATE UNIQUE INDEX invites_pending_unique ON invites (workspace_id, email)
  WHERE accepted_at IS NULL;
