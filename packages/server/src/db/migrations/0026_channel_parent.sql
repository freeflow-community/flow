-- Sub-channels (issue #118): a channel may hang off another channel, and
-- clients render it indented under its parent.
--
-- Deliberately a single nullable self-reference rather than a path/closure
-- table: nesting is capped at one level in the service, so the recursive
-- queries those designs buy us have nothing to walk. Parents are validated
-- there too (same workspace, standard kind, not archived, not itself a child)
-- because none of that is expressible in a FK.
--
-- ON DELETE SET NULL, not CASCADE: a child is an ordinary channel with its own
-- members and history, and deleting a parent should not silently delete
-- conversations nobody agreed to lose. It just becomes top-level again.
-- (Archiving a parent leaves the row alone; the child keeps pointing at an
-- archived channel it can no longer be drawn under, and clients fall back to
-- rendering it at top level.)

ALTER TABLE channels
  ADD COLUMN parent_id uuid REFERENCES channels(id) ON DELETE SET NULL;

-- Every child lookup is "the children of this channel", and the column is null
-- for the overwhelming majority of rows.
CREATE INDEX channels_parent_idx ON channels(parent_id) WHERE parent_id IS NOT NULL;
