#!/usr/bin/env bash
# Find task locks nobody is holding any more, and say so in Flow.
#
#   sweep-locks.sh [hours]        # default 2
#
# A run that dies leaves its ref lock behind and its board item on "In
# Progress". The board then lies: it claims the work is being handled when
# nothing is working it, and the batch is unreachable because the lock blocks
# the next claim.
#
# This reports. It does NOT delete, for the same reason the skill never moves a
# Blocked item back to Queued for Dev: clearing the symptom silently sends the
# next machine into the same wall. A human decides, with
# `task-lock.sh release <key>`.
set -uo pipefail

REPO_ROOT=${FLOW_REPO_ROOT:-$HOME/flow}
HOURS=${1:-2}
CHANNEL=${FLOW_SWEEP_CHANNEL:-#flow-task-work}
# One report per lock per day, so an unattended stale lock does not post hourly.
SEEN=${FLOW_SWEEP_SEEN:-$HOME/.flow-sweep-seen}

cd "$REPO_ROOT" || exit 1
touch "$SEEN"

STALE=$(bash .claude/skills/work-project-tasks/task-lock.sh sweep "$HOURS" 2>/dev/null | grep '^STALE:' || true)
[ -z "$STALE" ] && exit 0

TODAY=$(date '+%Y-%m-%d')
NEW=""
while IFS= read -r line; do
  [ -n "$line" ] || continue
  key=$(printf '%s' "$line" | sed -n 's/^STALE: task-\([^ ]*\) .*/\1/p')
  if ! grep -qF "$TODAY task-$key" "$SEEN"; then
    echo "$TODAY task-$key" >> "$SEEN"
    NEW="$NEW$line"$'\n'
  fi
done <<<"$STALE"

[ -z "$NEW" ] && exit 0

claude -p "Post this to the Flow channel $CHANNEL, unchanged apart from formatting, and do nothing else:

Stale task locks — held for over ${HOURS}h with no run finishing them. The board still shows these as In Progress, and the lock blocks the next claim.

$NEW
Release one with: bash .claude/skills/work-project-tasks/task-lock.sh release <batch>
Check first whether the run is genuinely dead — a long build is not a stale lock." \
  --permission-mode acceptEdits >/dev/null 2>&1
