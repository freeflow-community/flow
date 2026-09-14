-- APNs device-token registry (#245, PUSH_APNS.md § "Device-token registry").
-- Nothing sends push yet; this is only somewhere to put the tokens.
--
-- `token` is unique GLOBALLY, not per user. A phone handed to someone else
-- re-registers the same APNs token under the new account, and the upsert has to
-- rebind it (ON CONFLICT (token) DO UPDATE SET user_id = ...) rather than
-- duplicate — otherwise the previous owner's notifications keep arriving on a
-- phone that is no longer theirs. The constraint on the token alone is what
-- makes that upsert possible.
CREATE TABLE device_tokens (
  id           uuid PRIMARY KEY,              -- uuidv7
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token        text NOT NULL UNIQUE,          -- APNs device token, hex
  platform     text NOT NULL,                 -- 'ios' (macOS later)
  environment  text NOT NULL,                 -- 'sandbox' | 'production'
  bundle_id    text NOT NULL,                 -- APNs topic
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  disabled_at  timestamptz                    -- set on APNs 410 Unregistered
);

-- The only read the sender will do: "which live devices does this user have?"
CREATE INDEX device_tokens_user_idx ON device_tokens (user_id) WHERE disabled_at IS NULL;
