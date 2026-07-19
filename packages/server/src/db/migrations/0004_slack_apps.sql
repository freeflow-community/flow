-- Phase 4: Slack app compatibility (phase4.md §1) — apps, bot users, event outbox.

ALTER TABLE users ADD COLUMN is_bot boolean NOT NULL DEFAULT false;

CREATE TABLE apps (
  id             uuid PRIMARY KEY,
  workspace_id   uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name           text NOT NULL,
  bot_user_id    uuid NOT NULL REFERENCES users(id),   -- every app gets a bot user row
  bot_token_hash bytea UNIQUE NOT NULL,                -- raw token shown once ("xoxb-" prefix for client-lib compat)
  signing_secret text NOT NULL,                        -- outgoing event signatures (v0 HMAC)
  event_url      text,                                 -- Events API subscription endpoint
  event_url_verified_at timestamptz,                   -- answered the url_verification challenge
  event_types    text[] NOT NULL DEFAULT '{}',
  created_by     uuid NOT NULL REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  disabled_at    timestamptz
);
CREATE INDEX apps_workspace_idx ON apps (workspace_id);

-- Events API outbox (2026-07-18 ruling 3: Postgres outbox, not a broker consumer).
-- Rows are written in the same transaction as the triggering write and drained
-- by an in-process worker (at-least-once, survives restarts).
CREATE TABLE pending_app_events (
  id              uuid PRIMARY KEY,          -- uuidv7
  app_id          uuid NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  event_type      text NOT NULL,             -- slack event type (message.channels, reaction_added, …)
  payload         jsonb NOT NULL,            -- the "event" object of the callback envelope
  attempts        int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  delivered_at    timestamptz,
  failed_at       timestamptz                -- gave up (after retries) — app delivery auto-disabled
);
CREATE INDEX pending_app_events_due ON pending_app_events (next_attempt_at)
  WHERE delivered_at IS NULL AND failed_at IS NULL;
