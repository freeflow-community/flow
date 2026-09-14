# Bridge: overlapping turns no longer leave a stuck channel spinner or drop a reply (#522)

- `[bridge]` A follow-up turn (background task finished) and a message's turn now keep separate runs: each gets its own
  reporter and reply, narration goes to the turn actually running, and `/stop` targets that turn.
- `[bridge]` The channel indicator is leased per channel, so one turn finishing can't clear another's spinner; session
  dispose (reap, `/reset`, shutdown) and bridge startup clear any leftover indicator of ours.

## Feature

- **Agent spinners stop when the agent does.** A channel no longer keeps spinning after an agent goes quiet, and an
  agent's reply to finished background work is no longer lost when you message it at the same moment.
