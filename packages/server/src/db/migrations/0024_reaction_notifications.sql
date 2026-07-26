-- Issue #63 (fix notifications): reactions on your own messages become
-- notifications (kind 4), so a notification's actor is no longer always the
-- message author — record it explicitly, plus the emoji for the feed row.
ALTER TABLE notifications ADD COLUMN actor_id uuid REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE notifications ADD COLUMN reaction_emoji text;

-- Backfill: every pre-existing row was caused by the message's author.
UPDATE notifications n
   SET actor_id = m.user_id
  FROM messages m
 WHERE m.id = n.message_id AND n.actor_id IS NULL;

-- "Which of my unread rows came from this channel?" — the query behind
-- clearing notifications when you visit the channel/thread they came from.
CREATE INDEX notifications_unread_channel_idx
    ON notifications (user_id, channel_id)
 WHERE read_at IS NULL;

-- One reaction on one message notifies its author once, no matter how many
-- times it is added and removed (and it never resurrects as unread).
CREATE UNIQUE INDEX notifications_reaction_uniq
    ON notifications (user_id, message_id, actor_id, reaction_emoji)
 WHERE kind = 4;
