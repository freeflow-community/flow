-- Workspace delete 500 (#342 follow-up): message_files.file_id had no ON
-- DELETE action, so the workspace cascade — which reaches files both directly
-- (workspaces→files) and via messages (workspaces→channels→messages→
-- message_files) — could delete a file before the join row referencing it,
-- tripping the constraint (23503) and rolling the whole delete back. A join
-- row without its file is meaningless; cascade it.
ALTER TABLE message_files DROP CONSTRAINT message_files_file_id_fkey;
ALTER TABLE message_files
  ADD CONSTRAINT message_files_file_id_fkey
  FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE;
