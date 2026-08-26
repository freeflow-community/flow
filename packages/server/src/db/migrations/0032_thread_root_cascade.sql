-- A permanently deleted thread root must take its replies with it. The
-- original FK used NO ACTION, which made a hard delete fail whenever the root
-- had replies. Replacing it with ON DELETE CASCADE keeps the operation atomic
-- and prevents a concurrent reply from becoming orphaned.
ALTER TABLE messages
  DROP CONSTRAINT IF EXISTS messages_thread_root_id_fkey;

ALTER TABLE messages
  ADD CONSTRAINT messages_thread_root_id_fkey
  FOREIGN KEY (thread_root_id) REFERENCES messages(id) ON DELETE CASCADE;
