# Thread titles name their parent conversation on phone-sized screens

- `[ios]` Thread screen's nav title becomes "Thread" over the parent
  conversation — `in #channel`, or `with <name>` for a DM or group DM (the
  bar is too narrow to run both inline). Tapping it pops back to the channel.
- `[web]` Same label on the thread tab below the `md` breakpoint, where the
  panel covers the channel full-screen. Desktop width is unchanged: the
  channel's own header is already on screen beside the panel.
- `[web]` `[ios]` One rule for the parent's name — `threadParentLabel` in
  `lib/channelTitle.ts` and on the `Channel` model — so group DMs reuse the
  display name the sidebar already shows them under.

## Feature

- **Threads on a phone say which conversation they belong to.** A thread's
  title now reads "Thread in #design" or "Thread with Ada" instead of just
  "Thread", and tapping the name takes you back to the conversation.
