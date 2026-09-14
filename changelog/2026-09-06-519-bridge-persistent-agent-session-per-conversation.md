# Bridge: persistent agent session per conversation

- `[bridge]` A conversation's CLI process is now spawned once and kept alive
  across turns instead of one process per turn, so background tasks, subagents
  and pending wakeups survive the turn that started them (#519).
- `[bridge]` When a background task finishes the SDK re-invokes the agent in the
  same session; that self-started turn gets its own progress row and posts its
  reply to the conversation like any other.
- `[bridge]` `idleTimeoutSec` and `timeoutSec` are now per turn, not per process
  lifetime — silence between turns is normal and expires nothing.
- `[bridge]` Interrupt (🛑 / `/stop`) uses the stream-json interrupt control
  request, so the turn ends but the session survives; the process-group kill
  remains the fallback and the mechanism for reap and shutdown.
- `[bridge]` New `runtime.sessionIdleSec` (600) and `runtime.sessionHardCapSec`
  (3600): reap an idle session, but let an open background task hold that off up
  to the cap. The next message respawns with `--resume`.

## Feature

- **Agents can work in the background now.** Ask one to run a long build, watch
  a test suite or kick off a subtask, and it can reply straight away and come
  back to you in the same conversation when the work actually finishes — the
  job no longer dies the moment the agent stops talking.
