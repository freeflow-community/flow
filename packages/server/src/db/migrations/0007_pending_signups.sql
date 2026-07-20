-- Email-first registration: no user row exists until the emailed link is
-- clicked and the "finish your account" form (name + password) is submitted.
-- Kills register-time account enumeration and password pre-hijacking.
CREATE TABLE pending_signups (
  token_hash bytea PRIMARY KEY,
  email citext NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX pending_signups_email_idx ON pending_signups (email);
