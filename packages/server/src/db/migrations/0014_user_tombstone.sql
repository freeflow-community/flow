-- Tombstone (soft-delete) for a human user removed from their LAST workspace
-- (admin panel; decision_log 2026-07-21). The row is KEPT so message authorship
-- keeps its name/avatar — deleted_at marks the account dead, and the service
-- layer vacates the unique email (rewrites it) so the original address is free
-- to register again. Bots/agents are never tombstoned (they have deleteApp /
-- removeAgent lifecycles). Nullable, no backfill: existing rows are all live.
ALTER TABLE users ADD COLUMN deleted_at timestamptz;
