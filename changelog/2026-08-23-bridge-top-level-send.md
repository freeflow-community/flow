# Agents can post top-level to a channel from inside a thread

- `[bridge]` `send_message` and `upload_file` now inherit the ambient thread
  only when the call names no `channelId`. Passing a `channelId` posts
  top-level in that channel — including the channel the current thread lives
  in, which was the case with no workaround: dispatch messages landed in the
  thread where the target agent never saw them (#320).
- `[bridge]` An empty `threadRootId` is an explicit "top-level" rather than a
  silent fall back to the current thread, and both tool descriptions now state
  how to pick between channel top-level and the current thread.
