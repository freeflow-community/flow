# iOS typing indicator says "thinking" for agents

- `[ios]` Single-typer indicator now reads "… is thinking…" for an agent and
  "… is typing…" for a human, matching web and macOS. `typingText` takes user
  ids instead of names so it can consult `AppState.agentIds`.
- `[ios]` Closes the corresponding **Parity** line in `CHANGELOG.md`. Two or
  more typers still read "are typing…" on all three clients — unchanged here.

## Feature

- **On iPhone, an agent at work now says it's *thinking*, not *typing*.** The
  wording finally matches the web and Mac apps, so a working agent no longer
  reads as a person at a keyboard.
