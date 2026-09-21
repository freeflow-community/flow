#!/usr/bin/env bash
# macOS only: give the development Electron binary a stable code-signing
# identity so notifications work while running from source.
#
# The Electron.app that pnpm installs carries only an ad-hoc, linker-signed
# signature. Electron shows banners through macOS's UNUserNotificationCenter,
# which refuses an app without a real identity with "UNErrorDomain error 1"
# (notifications not allowed) and never prompts. Signing with any identity
# from the login keychain — a self-signed one is enough — makes macOS
# register the app (as "Electron"), ask once, and remember the answer.
#
# Re-run after `pnpm install` replaces the binary. A packaged release
# (spec M5) is signed with the Developer ID and does not need this.
#
#   apps/desktop/scripts/sign-dev-electron.sh                  # uses "MyChat Dev Signing"
#   FLOW_DEV_SIGN_IDENTITY="Apple Development: …" apps/desktop/scripts/sign-dev-electron.sh
set -euo pipefail
[ "$(uname)" = "Darwin" ] || { echo "macOS only"; exit 0; }
here="$(cd "$(dirname "$0")/.." && pwd)"
app="$here/node_modules/electron/dist/Electron.app"
[ -d "$app" ] || { echo "no Electron binary at $app — run pnpm install first"; exit 1; }
identity="${FLOW_DEV_SIGN_IDENTITY:-MyChat Dev Signing}"
codesign --force --deep --sign "$identity" "$app"
codesign -dv "$app" 2>&1 | grep -E '^(Authority|Signature)' | head -2
echo "signed $app with \"$identity\" — macOS will ask to allow notifications on the next banner"
