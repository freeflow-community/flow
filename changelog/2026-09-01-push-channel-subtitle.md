# Push notifications name the conversation

- `[server]` APNs alerts now carry a `subtitle` row: `#channel` for a channel,
  the other members' names for a DM or group DM — so a banner says *where*
  without opening it (#460). Thread replies show the channel the thread is in.
- `[server]` The DM name is the server-side port of web's `dmTitle`, resolved
  from the recipient's side, so the phone matches the sidebar row it came from.
- `[ios]` No client change: nothing overrides `aps.alert`, so the row is drawn
  by iOS itself.

## Feature

- **Push notifications say which conversation they came from.** A banner now
  shows the channel — or the people, for a direct message — on its own line
  between the sender and the message, so you can tell what is worth opening
  from the lock screen.
