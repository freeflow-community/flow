#!/usr/bin/env bash
# Fire a real-shaped push notification at a booted iOS simulator.
#
# Push bugs are launch-state bugs — #458 was a crash on *tap*, identical in
# every other respect across foreground, background and cold start — and the
# only way to see one is to put the right bytes in front of the right app in
# the right state. That was hand-assembled JSON and hand-driven state changes
# on every run; this is the same thing in one command.
#
# The payload is not invented here. `--outbox` replays the literal bytes the
# server's dev push driver just wrote (`.push/`, the drain's own output), and
# otherwise packages/server/scripts/push-payload.ts calls the drain's
# `buildPushPayload` to synthesize one. Both then go through `xcrun simctl
# push`, which strips the `Simulator Target Bundle` key and hands the rest to
# the app exactly as APNs would.
#
# Usage:
#   scripts/push-sim.sh                          # channel message, app in foreground
#   scripts/push-sim.sh --event dm --state cold
#   scripts/push-sim.sh --event reaction --state background
#   scripts/push-sim.sh --outbox                 # replay the newest real drain push
#   scripts/push-sim.sh --matrix --event thread  # foreground, background, cold in turn
#
#   --event    message | mention | dm | group-dm | thread | reaction | added | badge
#   --state    foreground | background | cold          (default: foreground)
#   --matrix   run all three states, pausing between them
#   --outbox   replay the newest payload the running qa:up stack's server wrote
#   --device   simulator udid or name                  (default: the booted one)
#   --bundle   app bundle id                           (default: im.freeflow.app)
#   --body     alert body text
#   --actor    who it is from                          (default: Bob)
#   --keep     print the payload file path and leave it on disk
#
# When a `pnpm qa:up` stack is running, the routing keys (workspace, channel)
# are taken from its fixtures, so a tap lands somewhere that exists.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

EVENT=message
STATE=foreground
MATRIX=0
FROM_OUTBOX=0
DEVICE=""
BUNDLE=im.freeflow.app
KEEP=0
EXTRA=()

while [ $# -gt 0 ]; do
  case "$1" in
    --event) EVENT="$2"; shift 2 ;;
    --state) STATE="$2"; shift 2 ;;
    --device) DEVICE="$2"; shift 2 ;;
    --bundle) BUNDLE="$2"; shift 2 ;;
    --body) EXTRA+=(--body "$2"); shift 2 ;;
    --actor) EXTRA+=(--actor "$2"); shift 2 ;;
    --badge) EXTRA+=(--badge "$2"); shift 2 ;;
    --matrix) MATRIX=1; shift ;;
    --outbox) FROM_OUTBOX=1; shift ;;
    --keep) KEEP=1; shift ;;
    -h|--help) sed -n '2,36p' "${BASH_SOURCE[0]}" | sed 's|^# \{0,1\}||'; exit 0 ;;
    *) echo "push-sim: unknown option $1" >&2; exit 2 ;;
  esac
done

command -v xcrun >/dev/null || { echo "push-sim: xcrun not found — install Xcode." >&2; exit 1; }

# ---- the device --------------------------------------------------------
if [ -z "$DEVICE" ]; then
  DEVICE="$(xcrun simctl list devices booted -j \
    | /usr/bin/python3 -c 'import json,sys
d=json.load(sys.stdin)["devices"]
for rt in d:
  for dev in d[rt]:
    if dev.get("state")=="Booted": print(dev["udid"]); raise SystemExit')"
fi
if [ -z "$DEVICE" ]; then
  echo "push-sim: no booted simulator — boot one with" >&2
  echo "          xcrun simctl boot 'iPhone 17 Pro' && open -a Simulator   (or pnpm qa:up --sim)" >&2
  exit 1
fi

# ---- the payload -------------------------------------------------------
PAYLOAD="$(mktemp "${TMPDIR:-/tmp}/push-sim.XXXXXX.json")"
SOURCE=""

if [ "$FROM_OUTBOX" = 1 ]; then
  OUTBOX="$(/usr/bin/python3 -c 'import json,sys
try: print(json.load(open(".qa/stack.json"))["pushOutbox"])
except Exception: print("")' 2>/dev/null)"
  [ -n "$OUTBOX" ] || OUTBOX="packages/server/.push"
  NEWEST="$(ls -t "$OUTBOX"/*.json 2>/dev/null | head -1)"
  if [ -z "$NEWEST" ]; then
    echo "push-sim: no pushes in $OUTBOX — send a message to a device-registered user first" >&2
    exit 1
  fi
  cp "$NEWEST" "$PAYLOAD"
  SOURCE="replayed from $NEWEST"
else
  # Fill the routing keys from a running qa:up stack when there is one, so the
  # ids in the push are rows that actually exist.
  IDS=()
  if [ -f .qa/stack.json ]; then
    WS="$(/usr/bin/python3 -c 'import json;print(json.load(open(".qa/stack.json"))["workspace"]["id"])')"
    CH="$(/usr/bin/python3 -c 'import json;print(json.load(open(".qa/stack.json")).get("generalChannelId") or "")')"
    [ -n "$WS" ] && IDS+=(--workspace "$WS")
    [ -n "$CH" ] && IDS+=(--channel "$CH")
  fi
  ( cd packages/server && node --import tsx scripts/push-payload.ts \
      --event "$EVENT" --bundle "$BUNDLE" \
      ${IDS[@]+"${IDS[@]}"} ${EXTRA[@]+"${EXTRA[@]}"} ) >"$PAYLOAD" || {
    cat "$PAYLOAD" >&2; rm -f "$PAYLOAD"; exit 1; }
  SOURCE="built by buildPushPayload (--event $EVENT)"
fi

# ---- the launch state --------------------------------------------------
# `simctl launch` forwards SIMCTL_CHILD_* into the app's environment, and the
# iOS client reads FLOW_SERVER_URL first — so an app launched here talks to the
# running qa:up stack rather than production.
if [ -f .qa/stack.json ]; then
  export SIMCTL_CHILD_FLOW_SERVER_URL="$(/usr/bin/python3 -c 'import json;print(json.load(open(".qa/stack.json"))["api"])')"
fi

# The three states a push can arrive in. Only "background" needs the Simulator
# window driven, because simctl has no way to send an app to the background.
set_state() {
  case "$1" in
    cold)
      xcrun simctl terminate "$DEVICE" "$BUNDLE" >/dev/null 2>&1
      echo "  state: cold — app terminated, the push will launch it on tap"
      ;;
    foreground)
      xcrun simctl launch "$DEVICE" "$BUNDLE" >/dev/null 2>&1 \
        || { echo "  ! $BUNDLE is not installed on this simulator" >&2; return 1; }
      sleep 1
      echo "  state: foreground — app launched and frontmost"
      ;;
    background)
      xcrun simctl launch "$DEVICE" "$BUNDLE" >/dev/null 2>&1 \
        || { echo "  ! $BUNDLE is not installed on this simulator" >&2; return 1; }
      sleep 1
      open -a Simulator
      sleep 1
      # ⇧⌘H is the Simulator's Home. Needs Accessibility permission for the
      # terminal; without it the app simply stays frontmost and the run is a
      # foreground one, which the warning says out loud rather than pretending.
      if osascript -e 'tell application "System Events" to key code 4 using {command down, shift down}' 2>/dev/null; then
        sleep 1
        echo "  state: background — app sent Home"
      else
        echo "  ! could not send Home (grant Accessibility to this terminal); app is still in the foreground" >&2
        return 1
      fi
      ;;
    *) echo "push-sim: unknown --state $1" >&2; return 2 ;;
  esac
}

fire() {
  local state="$1"
  echo
  echo "push-sim: $SOURCE"
  set_state "$state"
  xcrun simctl push "$DEVICE" "$BUNDLE" "$PAYLOAD" \
    && echo "  delivered to $DEVICE ($BUNDLE)"
}

TITLE="$(/usr/bin/python3 -c 'import json,sys
p=json.load(open(sys.argv[1]))["aps"]
a=p.get("alert")
print((a if isinstance(a,str) else " / ".join(filter(None,[a.get("title"),a.get("subtitle"),a.get("body")]))) if a else "(silent, content-available)")' "$PAYLOAD")"
echo "push-sim: \"$TITLE\"  badge=$(/usr/bin/python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["aps"].get("badge"))' "$PAYLOAD")"

if [ "$MATRIX" = 1 ]; then
  for s in foreground background cold; do
    fire "$s"
    [ "$s" = cold ] || { echo "  … tap the banner, then press return for the next state"; read -r _; }
  done
else
  fire "$STATE"
fi

if [ "$KEEP" = 1 ]; then
  echo
  echo "payload: $PAYLOAD"
else
  rm -f "$PAYLOAD"
fi
