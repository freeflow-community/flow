# iOS thread titles name their parent channel

- `[ios]` Thread screen's nav title becomes "Thread" over the parent
  conversation — `in #channel`, or `with <name>` for a DM or group DM (the
  bar is too narrow to run both inline). Tapping it pops back to the channel.
- `[ios]` The name comes from a new `Channel.threadParentLabel`, so group DMs
  reuse the display name the sidebar already shows them under.

## Feature

- **Threads on iPhone say which conversation they belong to.** A thread's
  title now reads "Thread — in #design" or "Thread — with Ada" instead of just
  "Thread", and tapping the name takes you back to the conversation.
