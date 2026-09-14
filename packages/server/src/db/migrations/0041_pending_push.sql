-- APNs delivery outbox (#247, PUSH_APNS.md § "Delivery: outbox, not
-- fire-and-forget"). Modelled column-for-column on pending_app_events, which is
-- the Events API outbox from decision log 2026-07-18 ruling 3.
--
-- Why an outbox and not the NATS path: WS publish is loss-tolerant because
-- clients backfill over REST on reconnect. A phone with no socket has nothing to
-- backfill from, so a dropped push is a notification the user never learns
-- about. Rows are written in the SAME transaction as the notification row and
-- drained by an in-process worker — at-least-once, surviving restarts.
--
-- ONE ROW PER NOTIFICATION, not per device. There is deliberately no token
-- column: the worker looks up the user's live devices at send time, because
-- devices change between commit and delivery, and because the badge count is
-- computed once per notification rather than once per device.
CREATE TABLE pending_push (
  id              uuid PRIMARY KEY,              -- uuidv7
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- A hard-deleted message cascades its notifications away; the pending push
  -- goes with them, which is right — never push a row that no longer exists.
  notification_id uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  attempts        integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  delivered_at    timestamptz,
  failed_at       timestamptz
);

-- The drain's only read: "what is due and unresolved?"
CREATE INDEX pending_push_due ON pending_push (next_attempt_at)
  WHERE delivered_at IS NULL AND failed_at IS NULL;

-- The sustained-failure check reads a user's recent outcomes newest-first.
CREATE INDEX pending_push_user_idx ON pending_push (user_id, id DESC);
