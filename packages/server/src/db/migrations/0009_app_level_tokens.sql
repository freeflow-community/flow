-- Socket Mode compatibility: per-app app-level token ("xapp-…", hashed like
-- the bot token). Presence of a token marks the app socket-capable; events
-- for such apps stay queued in the outbox while no socket is connected.
ALTER TABLE apps ADD COLUMN app_token_hash bytea UNIQUE;
