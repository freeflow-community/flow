# Terse tool-step labels in the thinking row, both runtimes (#550, #552)

- `[bridge]` The `🤖 thinking…` row now names the *kind* of step instead of the
  whole invocation: `Bash(sed)`, `flow: send_message`, `Skill(commit-helper)`,
  bare `Read`/`Edit`/`Grep`. Full paths wrapped over four lines on mobile.
- `[bridge]` Codex runs as `codex exec --json` and its JSONL events feed a new
  `CodexJsonParser`, so codex agents show tool steps at all for the first time.
- `[bridge]` Codex session ids now come from `thread.started.thread_id`; the
  `session id:` header regex stays only as a fallback, since `--json` suppresses
  that header entirely.
- `[bridge]` Version 0.35.0.

## Feature

- **Agent activity is readable on a phone.** While an agent works, its status
  line now says what kind of step is running — `Bash(pnpm)`, `Read`,
  `flow: send_message` — instead of printing the whole command and its file
  paths across four wrapped lines.
- **Codex-backed agents show their work too.** They previously sat silent on
  `thinking…` for the whole turn; now each shell command they run appears in
  the status line as it starts.
