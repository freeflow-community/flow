-- User status (design 3a "Quiet, in violet"): emoji + label, empty strings = cleared.
ALTER TABLE users
  ADD COLUMN status_emoji text NOT NULL DEFAULT '',
  ADD COLUMN status_text  text NOT NULL DEFAULT '';
