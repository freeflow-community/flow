#!/bin/bash
# Regenerate the Flow app icon for both clients from the single CoreGraphics
# source (make-icon.swift): the macOS AppIcon.icns and the iOS AppIcon master.
# Committed outputs are checked in, so this only needs re-running when the
# design changes.
set -euo pipefail
cd "$(dirname "$0")"

REPO_ROOT="$(cd ../../.. && pwd)"
ICONSET="$(mktemp -d)/AppIcon.iconset"
MAC_ICNS="../Resources/AppIcon.icns"
IOS_PNG="$REPO_ROOT/apps/ios/Sources/Assets.xcassets/AppIcon.appiconset/icon-1024.png"
WEB_DIR="$REPO_ROOT/packages/web/public"

mkdir -p ../Resources
swift make-icon.swift "$ICONSET" "$IOS_PNG" "$WEB_DIR"

iconutil -c icns "$ICONSET" -o "$MAC_ICNS"
rm -rf "$ICONSET"

echo "macOS: $(cd .. && pwd)/Resources/AppIcon.icns"
echo "iOS:   $IOS_PNG"
echo "web:   $WEB_DIR/favicon-{16,32,48}.png + apple-touch-icon.png"
