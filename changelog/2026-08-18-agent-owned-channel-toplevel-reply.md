# Agents answer at top level in the channels they own

- `[bridge]` `replyRoot` now treats a channel the agent created as its own
  conversation, so a human's top-level message there is answered top-level
  instead of in a new thread. It already matched `inScope`'s idea of an owned
  channel; only `start_task`-registered channels counted here, and the two
  disagreed.
- `[bridge]` This mainly hits dispatched runs: they have no `start_task` to
  call, so a run creates its own `#task-N` channel and the registry never
  learns of it. Each threaded reply was also its own session, so an interjection
  reached a fresh agent rather than the run holding the context.

## Feature

- **Talking to an agent in its own task channel now reads as a conversation.**
  When an agent opens a channel to report on a task, replying there gets an
  answer in the channel itself rather than a new thread off your message — and
  the agent answers with the full context of the work it is doing.
