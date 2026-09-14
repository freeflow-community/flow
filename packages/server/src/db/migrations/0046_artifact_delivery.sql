-- Delivery intent must not be inferred from file lifecycle ownership.
ALTER TABLE artifacts ADD COLUMN requester_user_id uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE artifacts ADD COLUMN source_thread_root_id uuid REFERENCES messages(id) ON DELETE SET NULL;
ALTER TABLE artifacts ADD COLUMN operation_id uuid;
CREATE UNIQUE INDEX artifacts_delivery_operation ON artifacts(channel_id, created_by, operation_id);
