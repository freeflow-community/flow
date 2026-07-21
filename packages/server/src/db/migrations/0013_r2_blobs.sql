-- R2 blob storage + presigned direct uploads (decision log, 2026-07-20 R2 ruling).
-- enc_key_id becomes nullable: NULL means the blob is stored as plaintext
-- (R2 at-rest encryption + short-lived presigned URLs replace app-layer
-- AES-GCM, which cannot survive the server never seeing the bytes).
ALTER TABLE files ALTER COLUMN enc_key_id DROP NOT NULL;

-- Presigned-upload lifecycle: rows are created 'pending' at presign time and
-- flip to 'ready' once the client confirms the PUT and the server verifies the
-- object. Direct multipart uploads insert as 'ready'. Pending rows are never
-- attachable and are reaped by the orphan sweep.
ALTER TABLE files ADD COLUMN status text NOT NULL DEFAULT 'ready';
