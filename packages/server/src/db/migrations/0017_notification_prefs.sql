-- Phase 10: per-user notification preferences, status-driven alert
-- suppression, and the mention subkind (direct vs @here/@channel) used by the
-- server-side suppressAlert computation. Rows are always written; these only
-- gate OS alerts.
ALTER TABLE users ADD COLUMN notification_prefs jsonb NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN status_suppress_alerts boolean NOT NULL DEFAULT false;

-- 'mention' | 'here' | 'channel' for kind=0 rows; NULL for other kinds and
-- legacy rows (treated as 'mention' when computing suppression).
ALTER TABLE notifications ADD COLUMN subkind text;
