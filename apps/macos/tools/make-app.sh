#!/bin/bash
# Wraps the SwiftPM executable in a minimal Flow.app bundle (phase 2,
# operator ruling): enables UNUserNotificationCenter banners and registers the
# flow:// URL scheme with LaunchServices. `swift build` and the bare-executable
# QA launch path are untouched.
#
# Usage: tools/make-app.sh [debug|release]   (default: debug)
set -euo pipefail
cd "$(dirname "$0")/.."

CONF=${1:-debug}
swift build -c "$CONF"

BIN=".build/$CONF/Flow"
APP="dist/Flow.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/Flow"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key><string>Flow</string>
    <key>CFBundleDisplayName</key><string>Flow</string>
    <key>CFBundleIdentifier</key><string>com.flow.macos</string>
    <key>CFBundleVersion</key><string>2.0.0</string>
    <key>CFBundleShortVersionString</key><string>2.0.0</string>
    <key>CFBundleExecutable</key><string>Flow</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>LSMinimumSystemVersion</key><string>14.0</string>
    <key>NSHighResolutionCapable</key><true/>
    <key>NSPrincipalClass</key><string>NSApplication</string>
    <key>CFBundleURLTypes</key>
    <array>
        <dict>
            <key>CFBundleURLName</key><string>com.flow.macos.invite</string>
            <key>CFBundleURLSchemes</key>
            <array><string>flow</string></array>
        </dict>
    </array>
</dict>
</plist>
PLIST

# Signature: required for UserNotifications + Keychain on modern macOS.
# Prefer the stable "MyChat Dev Signing" identity (kept across the Flow rename) (self-signed, in the login
# keychain): a persistent identity means Keychain ACLs survive rebuilds, so
# the token-access prompt happens once ever instead of once per build.
# Fall back to ad-hoc when the identity is absent (fresh machines, CI).
IDENTITY="MyChat Dev Signing" # existing dev cert kept across the Flow rename (new cert = manual trust setup)
if security find-identity -p codesigning -v 2>/dev/null | grep -q "$IDENTITY"; then
  codesign --force -s "$IDENTITY" "$APP" >/dev/null 2>&1 \
    || codesign --force -s - "$APP" >/dev/null 2>&1 \
    || echo "warning: codesign failed (banners may not work)"
else
  codesign --force -s - "$APP" >/dev/null 2>&1 || echo "warning: codesign failed (banners may not work)"
fi

# Register the flow:// scheme with LaunchServices.
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
  -f "$(pwd)/$APP" >/dev/null 2>&1 || true

echo "Built $APP"
echo "Run with:  open $APP    (or FLOW_PROFILE=name $APP/Contents/MacOS/Flow)"
