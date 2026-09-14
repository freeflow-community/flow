# Bridge: codex runtime resumes its session between turns

- `[bridge]` A codex-runtime conversation now resumes its recorded session on
  every follow-up turn (`codex exec resume <id>`, id parsed from the run
  header) instead of spawning a context-free fresh run — before this, a codex
  agent forgot everything after its first turn, and a killed run lost the
  whole build. The system prompt rides only on the session's first run; a
  resume that fails without recording itself falls back to a fresh session so
  a pruned id can't wedge the conversation. `/reset` still discards it.
- `[bridge]` Bumped to 0.34.3.

## Feature

- **Codex-based agents remember the conversation.** Follow-up messages to a
  codex agent now continue its session — with everything it read, wrote and
  concluded — instead of starting from a blank slate each time, and an
  interrupted run can pick up where it stopped.
