# A 1:1 DM push no longer repeats the sender

- `[server]` Follow-up to the conversation subtitle (#460): a 1:1 DM gets no
  subtitle row, because its counterpart is the sender the title already names.
  Decided on ids, not string equality, so it also covers the preview-off title
  and reaction titles. Group DMs keep their row.
- `[qa]` Drain assertions wait for the `pending_push` row: `sendMessage` and
  `addReaction` write the notification without the caller awaiting it, so a
  drain fired the same tick could find an empty outbox.

## Feature

- **A direct message notification doesn't say the sender's name twice.** The
  banner names the person once; group messages still list who is in them.
