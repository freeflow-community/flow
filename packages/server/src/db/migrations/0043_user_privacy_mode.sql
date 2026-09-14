-- Privacy mode (#489): the member asks that their email address never leave the
-- server and that they not be listed in the workspace Directory. Off by default,
-- so every existing row keeps behaving exactly as it did.
-- Only the account owner writes it (PatchMeBody, the single write path); the
-- flag itself is not a secret — clients need it to know whom to leave out of
-- the Directory.
ALTER TABLE users ADD COLUMN IF NOT EXISTS privacy_mode boolean NOT NULL DEFAULT false;
