-- Phase 16: Google Sign-In + domain self-registration.
--
-- oauth_identities binds an external IdP subject to a Flow user. Provider-
-- agnostic on purpose so Microsoft/Okta slot in later without another table.
-- The (provider, provider_subject) pair is the durable join key — Google's
-- `sub` survives an email change — while `email` is kept for display/audit and
-- refreshed on every sign-in.
CREATE TABLE oauth_identities (
  provider         text NOT NULL,                                  -- 'google'
  provider_subject text NOT NULL,                                  -- Google `sub`
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email            citext NOT NULL,                                -- verified email at last sign-in
  hosted_domain    citext,                                         -- Google `hd` (Workspace accounts only)
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, provider_subject)
);
CREATE INDEX oauth_identities_user_idx ON oauth_identities (user_id);

-- Domain self-registration: NULL (the default) means off. A non-null value is
-- the lowercased email domain whose verified Google users auto-enroll.
ALTER TABLE workspaces ADD COLUMN google_self_register_domain citext;
CREATE INDEX workspaces_google_self_register_domain_idx
  ON workspaces (google_self_register_domain)
  WHERE google_self_register_domain IS NOT NULL;
