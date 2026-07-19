-- Email verification + password reset.
-- Existing accounts are grandfathered as verified (verification only gates
-- registrations made after this ships).
ALTER TABLE users ADD COLUMN email_verified_at timestamptz;
UPDATE users SET email_verified_at = now();

-- Single-use emailed tokens (verify link, reset link). Raw token never stored.
CREATE TABLE email_tokens (
  token_hash bytea PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('verify_email', 'password_reset')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX email_tokens_user_purpose_idx ON email_tokens (user_id, purpose);
