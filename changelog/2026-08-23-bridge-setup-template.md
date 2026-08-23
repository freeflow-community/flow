# Bridge setup reads agent.example.json defaults

- `[bridge]` First-run setup now merges an `agent.example.json` sitting next
  to the target config: its keys (persona, runtime settings, scope) become the
  written agent.json's base, with the freshly minted credentials on top.
  `name` / `username` / `description` and `runtime.kind` / `runtime.cwd` seed
  the prompts, so `npx flow-agent-bridge <invite-code>` in a prepared folder
  runs with no questions. Version 0.21.0.

## Feature

- **Template a Flow agent's setup.** Put an `agent.example.json` with your
  agent's persona and settings in a folder, run
  `npx flow-agent-bridge <invite-code>` there, and the agent joins and starts
  with those defaults — no prompts, nothing to re-enter.
