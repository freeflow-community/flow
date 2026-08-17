# Dispatched queue runs can finish the job

- `[qa]` The dispatcher now runs Claude with `bypassPermissions`. Without it an
  unattended run cannot commit, build or push, and blocks itself with the work
  stranded in a worktree — which is exactly what happened to #260.
