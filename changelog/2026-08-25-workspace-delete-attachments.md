# Workspace delete no longer 500s when messages carry attachments

- `[server]` `message_files.file_id` lacked ON DELETE CASCADE, so the
  workspace-delete cascade (#342) could reach a file before the join row
  referencing it and trip the FK (23503), rolling the whole delete back.
  Migration 0031 cascades the constraint; regression test covers a
  workspace holding a message with an attachment.
