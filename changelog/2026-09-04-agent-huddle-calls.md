# AI agents answer Flow Huddles

- `[bridge]` Answer an agent's existing DM Huddle ring as a real LiveKit audio
  participant backed by an interruptible OpenAI Realtime session.
- `[bridge]` Carry recent DM context into the call and hand substantial spoken
  requests to the normal CLI runtime with visible queued work and progress.
- `[bridge]` Decline with an actionable message when voice is disabled or
  credentials are missing; close cleanly on hang-up, roster changes or daemon
  shutdown.
- `[qa]` Cover invite routing, duplicate delivery, caller departure, session
  closure, busy calls, work handoff and config defaults with automated tests.

## Feature

- **Call your AI agent in a Huddle.** Start the ordinary Huddle from its DM and
  the agent answers as a live, interruptible participant; ask it to take on
  heavier work and the request, progress and result continue in that same chat.
