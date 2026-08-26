# /model command: switch the agent's model per conversation or per turn

- `[bridge]` New `/model` command: bare `/model` reports the model in effect,
  `/model <name>` pins it for the conversation, `/model <name> <prompt>` runs
  one turn on it, `/model default` reverts to the configured default.
- `[bridge]` Safe mid-conversation: each turn is a fresh CLI spawn, so a
  resumed session accepts a different `--model` with its context intact.

## Feature

- **Switch your agent's model from chat.** Send `/model opus` to an agent to
  pin a model for the conversation, or `/model opus <your request>` to use it
  for just that one reply. `/model` shows what it is running now, and
  `/model default` switches back.
