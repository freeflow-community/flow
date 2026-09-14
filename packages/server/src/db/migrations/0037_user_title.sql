-- One-line profile title (#434): "Founder, Biztrip AI" under the name on a
-- Directory card. Defaults to '' rather than NULL so every client renders it
-- without a null check, matching website / bio from 0029.
-- Trimming and the 80-char limit live in the Zod schema (PatchMeBody), the
-- single write path; the column just stores the text.
ALTER TABLE users ADD COLUMN IF NOT EXISTS title text NOT NULL DEFAULT '';
