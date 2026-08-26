-- Mini apps (docs/design/MINI_APPS.md, step 1): a link artifact can be marked as
-- an "app" — it owns a per-artifact secret that the Flow server uses to mint
-- short-lived HMAC identity tokens for channel members. A guard process in front
-- of the app verifies those tokens offline, so the secret never travels after
-- creation (and after a rotation).
--
-- The secret is encrypted at rest with the same AES-256-GCM envelope as message
-- bodies: ciphertext||tag in app_secret, its nonce in app_secret_nonce, and the
-- data key identified by app_enc_key_id (never stored in Postgres). All four
-- columns are NULL together — that is what "not an app" means, and it is why
-- app_secret is the isApp discriminator rather than a separate boolean.
ALTER TABLE artifacts ADD COLUMN app_secret       bytea;
ALTER TABLE artifacts ADD COLUMN app_secret_nonce bytea;
ALTER TABLE artifacts ADD COLUMN app_enc_key_id   text;
ALTER TABLE artifacts ADD COLUMN app_enc_scheme   smallint;
-- Only link artifacts can be apps, and an encrypted secret is meaningless
-- without its nonce and key id — keep half-written rows out of the table.
ALTER TABLE artifacts
  ADD CONSTRAINT artifacts_app_shape CHECK (
    app_secret IS NULL
    OR (kind = 'link' AND app_secret_nonce IS NOT NULL AND app_enc_key_id IS NOT NULL AND app_enc_scheme IS NOT NULL)
  );
