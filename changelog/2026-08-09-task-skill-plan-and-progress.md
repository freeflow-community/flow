# Task runs post a plan, then report progress against it

- `[qa]` `work-project-tasks` now requires a numbered plan in the task channel
  before any code, and one short message per plan step finished — so a reader
  can tell how far a run has got without asking.
- `[qa]` Cadence is tied to the plan, not the clock: no "still working"
  messages, and a changed plan must be re-posted with its reason.
