-- Scheduled messages (#419): "write it once, Flow posts it as me on a schedule".
--
-- A row is a *pending message*, not a job: the body is encrypted with the same
-- envelope every `messages` row uses, and firing it means calling the ordinary
-- send path as the author, so fanout, unreads, push and agent mentions all
-- behave exactly as if they had typed it. `messages.scheduled` is the only
-- thing that distinguishes the result — a flag clients render as a badge.
--
-- `recurrence` is jsonb rather than a bare cron string so a client can
-- round-trip "every 12 hours starting 6 AM" back into its own dropdowns;
-- {"type":"cron"} is the advanced escape hatch. Occurrences are computed in
-- `timezone`, which is why the rule is stored in local terms and `next_run_at`
-- (the only thing the scheduler queries) is an absolute instant.
ALTER TABLE messages ADD COLUMN scheduled boolean NOT NULL DEFAULT false;

CREATE TABLE scheduled_messages (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- destination conversation: a channel, or the author's self-DM ("Just me")
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  author_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body bytea NOT NULL,
  body_nonce bytea NOT NULL,
  enc_key_id text NOT NULL,
  enc_scheme smallint NOT NULL DEFAULT 1,
  recurrence jsonb NOT NULL,
  timezone text NOT NULL DEFAULT 'UTC',
  next_run_at timestamptz,
  enabled boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  last_run_status text,
  -- the message the last successful run posted — what "view output" jumps to
  last_message_id uuid REFERENCES messages(id) ON DELETE SET NULL,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- The ticker's only query: due, enabled rows. Partial so the index stays the
-- size of the work queue rather than the size of the table.
CREATE INDEX scheduled_messages_due_idx ON scheduled_messages (next_run_at)
  WHERE enabled AND next_run_at IS NOT NULL;
-- Listing is always scoped to one workspace, then filtered by visibility.
CREATE INDEX scheduled_messages_workspace_idx ON scheduled_messages (workspace_id, created_at DESC);
CREATE INDEX scheduled_messages_author_idx ON scheduled_messages (author_user_id);
