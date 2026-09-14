# Automatic dispatch for the work queue

- `[qa]` A LaunchAgent ticks every 3 minutes and starts a run for the next
  `Queued for Dev` batch, so queueing a task is now the go-ahead. Guards on a
  concurrency cap and on any release in progress.
- `[qa]` `task-lock.sh` claims a batch by creating a git ref, which is a real
  compare-and-swap — the Status field is last-write-wins and cannot stop two
  machines taking the same work.
- `[qa]` An hourly sweeper reports locks held over 2h to Flow. It reports and
  does not delete: a lock that keeps going stale is a bug worth seeing.
