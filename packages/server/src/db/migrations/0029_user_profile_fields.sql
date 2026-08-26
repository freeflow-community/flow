-- Expanded user profiles (#220): a personal website link and a free-text bio.
-- Both default to '' rather than NULL so every client can render them without a
-- null check, matching status_emoji / status_text above them.
-- The http/https-only rule for `website` lives in the Zod schema (PatchMeBody),
-- which is the single write path; the column itself just stores the text.
ALTER TABLE users ADD COLUMN IF NOT EXISTS website text NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio text NOT NULL DEFAULT '';
