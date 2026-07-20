-- ui_nits: app tokens viewable later in Manage Apps (PM ruling, pending
-- operator review — see decision_log 2026-07-20): raw tokens stored alongside
-- the auth hashes. Rows predating this migration keep NULL (the raw token is
-- unrecoverable from its hash) — the UI offers Regenerate for those.
ALTER TABLE apps ADD COLUMN bot_token text;
ALTER TABLE apps ADD COLUMN app_token text;
