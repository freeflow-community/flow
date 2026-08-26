#!/usr/bin/env bash
# Share-extension QA (issue #214), end to end on a simulator.
#
# Builds the app + FlowShare against a REMOTE server, installs it, seeds the
# simulator, signs the app in, and runs ShareExtensionTests. Seeded (issue
# #219 added the last three):
#
#   - a 12 MP HEIC and a short movie in the photo library (`simctl addmedia`)
#   - a PDF in the Files app's "On My iPhone"
#   - a 600 MB file there too, for the over-size error
#
# The server must not be localhost. `Server.storageSuffix` is empty for
# 127.0.0.1:8787, so a local build makes the app and the extension agree on the
# Keychain account name by accident — the exact bug this feature has to avoid
# would pass unnoticed.
#
# Sign-in takes either a password account or a one-time app-link code:
#
#   FLOW_QA_EMAIL=…    FLOW_QA_PASSWORD=…     (a normal account)
#   FLOW_QA_TOKEN=…                           (any session/agent token; the
#                                              script mints the link code)
#
# Usage:
#   FLOW_QA_SERVER=https://app.freeflow.im \
#   FLOW_QA_EMAIL=qa@example.com FLOW_QA_PASSWORD=… \
#   apps/ios/tools/qa-share-extension.sh [<simulator udid>]
set -euo pipefail

cd "$(dirname "$0")/.."

SERVER="${FLOW_QA_SERVER:-https://app.freeflow.im}"
DEVICE="${1:-${FLOW_QA_DEVICE:-}}"
CHANNEL="${FLOW_QA_CHANNEL:-}"
IMAGE="${FLOW_QA_IMAGE:-/tmp/qa-12mp.heic}"
VIDEO="${FLOW_QA_VIDEO:-/tmp/qa-share-219.mp4}"
DOCUMENT="${FLOW_QA_DOCUMENT:-/tmp/qa-share-219.pdf}"
OVERSIZE="${FLOW_QA_OVERSIZE:-/tmp/qa-oversize-219.bin}"
DD="${FLOW_QA_DERIVED_DATA:-/tmp/dd-share}"

case "$SERVER" in
  *127.0.0.1*|*localhost*)
    echo "error: $SERVER is local. This QA proves nothing against localhost — see the header." >&2
    exit 1
    ;;
esac

if [ -z "$DEVICE" ]; then
  echo "error: pass a simulator udid (xcrun simctl list devices). Deliberately not guessed:" >&2
  echo "       other agents share this machine and a booted simulator may not be yours." >&2
  exit 1
fi

# A 12 MP HEIC is the point of AC 6 — 4032x3024 is what a phone camera makes,
# and it is the size that gets a share extension jetsammed if anything decodes
# it whole.
if [ ! -f "$IMAGE" ]; then
  echo "error: no test image at $IMAGE. Make one 4032x3024 and convert it:" >&2
  echo "       sips -s format heic <big.png> --out $IMAGE" >&2
  exit 1
fi

# The rest of the fixtures are cheap enough to make here rather than demand.
if [ ! -f "$VIDEO" ]; then
  echo "==> making a test movie at $VIDEO"
  swift tools/make-test-video.swift "$VIDEO" >/dev/null
fi
if [ ! -f "$DOCUMENT" ]; then
  echo "==> making a test PDF at $DOCUMENT"
  printf 'Flow QA — issue 219\nShared from the Files app.\n' > "${DOCUMENT%.pdf}.txt"
  cupsfilter "${DOCUMENT%.pdf}.txt" > "$DOCUMENT" 2>/dev/null
fi
# Sparse — 600 MB of address space, ~16 KB on disk. The size check reads the
# file's *reported* size, which is the number under test.
[ -f "$OVERSIZE" ] || mkfile -n 600m "$OVERSIZE"

echo "==> pointing the build at $SERVER"
trap 'git checkout -- project.yml 2>/dev/null || true' EXIT
sed -i '' "s|FlowServerURL: https://[^ ]*|FlowServerURL: $SERVER|g" project.yml
xcodegen generate >/dev/null

echo "==> building"
xcodebuild build -project FlowiOS.xcodeproj -scheme Flow \
  -destination "id=$DEVICE" -derivedDataPath "$DD" >/dev/null

echo "==> installing + seeding the photo library"
xcrun simctl boot "$DEVICE" 2>/dev/null || true
xcrun simctl install "$DEVICE" "$DD/Build/Products/Debug-iphonesimulator/Flow.app"
# Order is irrelevant — the tests pick a tile by "Photo, …"/"Video, …" label,
# not by position.
xcrun simctl addmedia "$DEVICE" "$IMAGE" "$VIDEO"

# "On My iPhone" is the Files app's local storage: an app group container whose
# metadata names it. Found rather than hardcoded — the group's directory is a
# fresh UUID on every simulator.
echo "==> seeding the Files app"
STORAGE=""
for group in "$HOME/Library/Developer/CoreSimulator/Devices/$DEVICE/data/Containers/Shared/AppGroup"/*; do
  meta="$group/.com.apple.mobile_container_manager.metadata.plist"
  id="$(/usr/libexec/PlistBuddy -c 'Print :MCMMetadataIdentifier' "$meta" 2>/dev/null || true)"
  if [ "$id" = "group.com.apple.FileProvider.LocalStorage" ]; then
    STORAGE="$group/File Provider Storage"
    break
  fi
done
if [ -z "$STORAGE" ]; then
  echo "error: no FileProvider.LocalStorage group on $DEVICE. Open the Files app once and re-run." >&2
  exit 1
fi
mkdir -p "$STORAGE"
cp "$DOCUMENT" "$OVERSIZE" "$STORAGE/"

echo "==> minting a sign-in credential"
if [ -n "${FLOW_QA_TOKEN:-}" ]; then
  CODE="$(curl -fsS -X POST -H "Authorization: Bearer $FLOW_QA_TOKEN" \
    "$SERVER/v1/auth/app-link" | python3 -c 'import sys,json;print(json.load(sys.stdin)["code"])')"
elif [ -n "${FLOW_QA_EMAIL:-}" ] && [ -n "${FLOW_QA_PASSWORD:-}" ]; then
  TOKEN="$(curl -fsS -X POST -H 'content-type: application/json' \
    -d "{\"email\":\"$FLOW_QA_EMAIL\",\"password\":\"$FLOW_QA_PASSWORD\"}" \
    "$SERVER/v1/auth/login" | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')"
  CODE="$(curl -fsS -X POST -H "Authorization: Bearer $TOKEN" \
    "$SERVER/v1/auth/app-link" | python3 -c 'import sys,json;print(json.load(sys.stdin)["code"])')"
else
  echo "error: set FLOW_QA_TOKEN, or FLOW_QA_EMAIL + FLOW_QA_PASSWORD." >&2
  exit 1
fi

# TEST_RUNNER_ is the only way environment reaches the test runner; a plain
# build setting on the xcodebuild line is ignored.
export TEST_RUNNER_FLOW_TEST_LINK_CODE="$CODE"
export TEST_RUNNER_FLOW_TEST_DOCUMENT="$(basename "$DOCUMENT")"
export TEST_RUNNER_FLOW_TEST_OVERSIZE="$(basename "$OVERSIZE")"
[ -n "$CHANNEL" ] && export TEST_RUNNER_FLOW_TEST_CHANNEL="$CHANNEL"

echo "==> running ShareExtensionTests against $SERVER"
xcodebuild test -project FlowiOS.xcodeproj -scheme Flow \
  -destination "id=$DEVICE" -derivedDataPath "$DD" \
  -only-testing:FlowUITests/ShareExtensionTests
