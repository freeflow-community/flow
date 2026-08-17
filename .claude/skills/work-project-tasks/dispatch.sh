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
# PERMISSIONS: THE DISPATCHED RUN BYPASSES THEM
#
# The run takes a batch all the way to a PR, so it needs git, pnpm, swift,
# xcodebuild and gh — and it is unattended, so there is nobody to answer a
# prompt. The first live run proved the failure mode: it wrote the whole of
# #260, then could not commit, build or push, and blocked itself with the code
# stranded in a worktree.
#
# `claude -p` gets no Flow MCP tools (those come from the agent-bridge, not
# from any .mcp.json), so it cannot create_channel or start_task. It therefore
# takes SKILL.md's inline fallback and does the work itself. Two consequences
# worth being clear about:
#
#   - There is no #task-N channel for a dispatched batch. Progress lives in
#     this log and in the PR, not in Flow. Wiring the bridge's MCP into this
#     invocation would restore the hand-off, and is the better long-term shape.
#   - bypassPermissions means an unattended agent can run anything on this
#     machine as this user. Operator decision, taken knowingly (Scott,
#     2026-08-16). The guards below are what bounds it: no dispatch during a
#     release, a concurrency cap, and one run at a time per machine.
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

# This blocks for as long as the batch takes — tens of minutes, not seconds,
# because with no Flow MCP the run cannot hand off and does the work itself.
# That is fine: the pid guard at the top makes the next tick a no-op, and the
# board's In Progress count stops a second batch starting behind it.
claude -p "$PROMPT" --permission-mode bypassPermissions 2>&1 | sed 's/^/    /'
say "dispatch run finished (exit ${PIPESTATUS[0]})"
