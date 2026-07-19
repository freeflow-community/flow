#!/bin/bash
# Wraps the SwiftPM executable in a minimal MyChat.app bundle (phase 2,
# operator ruling): enables UNUserNotificationCenter banners and registers the
# myapp:// URL scheme with LaunchServices. `swift build` and the bare-executable
# QA launch path are untouched.
#
# Usage: tools/make-app.sh [debug|release]   (default: debug)
set -euo pipefail
cd "$(dirname "$0")/.."

CONF=${1:-debug}
swift build -c "$CONF"

BIN=".build/$CONF/MyChat"
APP="dist/MyChat.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/MyChat"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key><string>MyChat</string>
    <key>CFBundleDisplayName</key><string>MyChat</string>
    <key>CFBundleIdentifier</key><string>com.mychat.macos</string>
    <key>CFBundleVersion</key><string>2.0.0</string>
    <key>CFBundleShortVersionString</key><string>2.0.0</string>
    <key>CFBundleExecutable</key><string>MyChat</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>LSMinimumSystemVersion</key><string>14.0</string>
    <key>NSHighResolutionCapable</key><true/>
    <key>NSPrincipalClass</key><string>NSApplication</string>
    <key>CFBundleURLTypes</key>
    <array>
        <dict>
            <key>CFBundleURLName</key><string>com.mychat.macos.invite</string>
            <key>CFBundleURLSchemes</key>
            <array><string>myapp</string></array>
        </dict>
    </array>
</dict>
</plist>
PLIST

# Signature: required for UserNotifications + Keychain on modern macOS.
# Prefer the stable "MyChat Dev Signing" identity (self-signed, in the login
# keychain): a persistent identity means Keychain ACLs survive rebuilds, so
# the token-access prompt happens once ever instead of once per build.
# Fall back to ad-hoc when the identity is absent (fresh machines, CI).
IDENTITY="MyChat Dev Signing"
if security find-identity -p codesigning -v 2>/dev/null | grep -q "$IDENTITY"; then
  codesign --force -s "$IDENTITY" "$APP" >/dev/null 2>&1 \
    || codesign --force -s - "$APP" >/dev/null 2>&1 \
    || echo "warning: codesign failed (banners may not work)"
else
  codesign --force -s - "$APP" >/dev/null 2>&1 || echo "warning: codesign failed (banners may not work)"
fi

# Register the myapp:// scheme with LaunchServices.
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
  -f "$(pwd)/$APP" >/dev/null 2>&1 || true

echo "Built $APP"
echo "Run with:  open $APP    (or MYCHAT_PROFILE=name $APP/Contents/MacOS/MyChat)"
