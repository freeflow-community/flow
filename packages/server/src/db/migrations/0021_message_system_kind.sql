-- Join/leave system messages (ui_nits): channel event lines rendered inline in
-- the stream, e.g. "Alice joined the channel". They are ordinary rows in
-- `messages` (encrypted body carries the pre-rendered sentence, authored by the
-- subject user) tagged with a non-null `system_kind` so clients style them as a
-- centered muted notice and the server excludes them from unread counts and
-- notifications. NULL = a normal user message.
ALTER TABLE messages ADD COLUMN system_kind text;
