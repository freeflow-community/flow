-- Web-to-app auth handoff (operator feature, 2026-07-19): one-time short-TTL
-- codes minted by an authenticated (web) session and exchanged once by the
-- native app for its own session token.
CREATE TABLE app_link_codes (
  code_hash bytea PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
