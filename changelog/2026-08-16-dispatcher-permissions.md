# Dispatched queue runs can finish the job

- `[qa]` The dispatcher now runs Claude with `bypassPermissions`. Without it an
  unattended run cannot commit, build or push, and blocks itself with the work
  stranded in a worktree — which is exactly what happened to #260.
- `[qa]` Dispatched runs get the `flow` MCP tools, so each batch still opens its
  own `#task-N` channel and invites the operator. The bridge spawns that server
  rather than containing it, so the dispatcher writes the same config.
