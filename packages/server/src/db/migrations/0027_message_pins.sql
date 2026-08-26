-- Channel-scoped pinned messages. A message can be pinned at most once; its
-- channel is duplicated here so listing a channel's pins stays index-backed.
CREATE TABLE message_pins (
  message_id uuid PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  pinned_by uuid REFERENCES users(id) ON DELETE SET NULL,
  pinned_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX message_pins_channel_idx
  ON message_pins (channel_id, pinned_at DESC);
