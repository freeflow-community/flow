#!/usr/bin/env bash
# One tick of the queue dispatcher: if work is queued and this machine has room
# for it, start a Claude Code run that takes the next batch off the board.
#
#   dispatch.sh              # run one tick
#   dispatch.sh --dry-run    # decide, print the decision, start nothing
#
# Installed as a LaunchAgent that fires every few minutes — see
# com.freeflow.flow-dispatcher.plist. Nothing here is Flow-specific: it decides
# *whether* to dispatch, and `claude -p` plus SKILL.md do the rest.
#
# WHAT THIS DOES NOT DO
#
# It does not claim the batch. Claiming belongs with the run that does the work,
# so the skill takes the cross-machine lock (task-lock.sh) as its first act. If
# two machines tick at the same moment, both may start a run and one will lose
# the lock and exit in seconds — which is cheap, and correct.
#
# The local flock below is not the lock that matters. It stops ONE machine
# racing itself when a tick runs long; the git ref is what stops two machines
# taking the same work.
set -uo pipefail

REPO_ROOT=${FLOW_REPO_ROOT:-$HOME/flow}
MAX_ACTIVE=${FLOW_MAX_ACTIVE:-2}
LOG=${FLOW_DISPATCH_LOG:-$HOME/flow-dispatcher.log}
PROMPT=${FLOW_DISPATCH_PROMPT:-"work on the next task from the active queue"}

DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

say() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }

# One dispatcher per machine. A tick that overruns must not stack.
exec 9>/tmp/flow-dispatcher.lock
if ! /usr/bin/flock -n 9 2>/dev/null; then
  # macOS has no flock(1) by default; fall back to a pid file.
  if [ -f /tmp/flow-dispatcher.pid ] && kill -0 "$(cat /tmp/flow-dispatcher.pid 2>/dev/null)" 2>/dev/null; then
    say "another tick is still running — skipping"; exit 0
  fi
  echo $$ > /tmp/flow-dispatcher.pid
  trap 'rm -f /tmp/flow-dispatcher.pid' EXIT
fi

cd "$REPO_ROOT" 2>/dev/null || { say "no repo at $REPO_ROOT"; exit 1; }

# A release owns the whole machine: it needs a clean main, and two Xcode builds
# at once is how you get a confusing failure in the one that matters.
if pgrep -f "release-macos.sh|release-ios.sh|publish-dmg.sh" >/dev/null 2>&1; then
  say "a release is running — skipping"; exit 0
fi

# Concurrency. Count what the board says is already being worked, not local
# processes: the other runs may be on another machine.
ACTIVE=$(gh project item-list 1 --owner freeflow-community --format json --limit 100 2>/dev/null \
  | python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: print(999); raise SystemExit
print(sum(1 for i in d.get('items',[]) if i.get('status')=='In Progress'))")

if [ "$ACTIVE" = "999" ]; then say "cannot read the board — skipping"; exit 0; fi
if [ "$ACTIVE" -ge "$MAX_ACTIVE" ]; then
  say "$ACTIVE task(s) already in progress (cap $MAX_ACTIVE) — skipping"; exit 0
fi

# Advisory only: the skill re-reads the queue and is the authority. This just
# avoids paying for a Claude run to discover the queue is empty.
BATCH=$(bash "$REPO_ROOT/.claude/skills/work-project-tasks/next-batch.sh" 2>/dev/null)
COUNT=$(printf '%s' "$BATCH" | python3 -c "
import json,sys
try: print(len(json.load(sys.stdin)))
except Exception: print(0)")

if [ "${COUNT:-0}" -eq 0 ]; then say "nothing queued"; exit 0; fi

KEY=$(printf '%s' "$BATCH" | python3 -c "
import json,sys
print(min(i['number'] for i in json.load(sys.stdin)))")

if [ "$DRY" = 1 ]; then
  say "would dispatch batch task-$KEY ($COUNT issue(s)); $ACTIVE active, cap $MAX_ACTIVE"
  exit 0
fi

say "dispatching batch task-$KEY ($COUNT issue(s)); $ACTIVE active, cap $MAX_ACTIVE"

# The skill claims, opens the channel, hands the work off with start_task and
# exits — usually inside a minute. The long run lives in the task channel, not
# here, so this call is not what takes 20 minutes.
claude -p "$PROMPT" --permission-mode acceptEdits 2>&1 | sed 's/^/    /'
say "dispatch run finished (exit ${PIPESTATUS[0]})"
