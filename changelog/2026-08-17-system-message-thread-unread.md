# Unread badge that could never be cleared

- `[server]` A thread reply to a join/leave line is now refused (400
  `bad_thread_root`). No client draws a thread affordance on a system message,
  so the thread — and the notification it raised — was unreachable (#270).
- `[server]` A channel visit also reads notifications already stuck under a
  system root, so badges trapped before the fix clear themselves.
- `[server]` `ChannelDTO.unreadThreadRootIds` — which threads in a channel are
  waiting on you.
- `[web]` `[macos]` `[ios]` An unread reply puts a dot on the message's
  "N replies" chip, so the transcript says *which* thread needs you and not
  just that the channel has something. Native clients get a GRDB `v15` column
  for it.

## Feature

- **You can tell which thread is waiting for you.** A message whose thread has
  a reply you haven't read now shows a dot on its reply chip, so you can find
  it in the conversation instead of hunting through Activity.
- **A channel badge can no longer get stuck.** Some replies raised a
  notification nothing could ever clear, leaving a permanent count on the
  channel; those clear now by opening the channel.
