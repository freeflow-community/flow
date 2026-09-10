# Fix the flaky pending-task session test

- `[qa]` `session.test.ts` asked its fake runtime for a `bg 60_000` task, but
  `Number('60_000')` is NaN (numeric separators only exist in source
  literals), so the "60-second" task completed instantly and its empty task
  snapshot raced the test's `pendingTasks` read — green when the assertion
  won, red under CI load when it lost (seen on main and on innocent PRs).
  The duration is now parseable, and the fixture throws on an unparseable
  one instead of silently shortening it.
