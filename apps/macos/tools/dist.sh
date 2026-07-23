#!/bin/bash
# Produce a signed, notarized, distributable macOS build of Flow.app — one
# non-interactive command after the one-time credential setup (phase 14, see
# docs/specs/phase14.md). Output: dist/Flow.dmg (a stapled dist/Flow.app inside),
# which opens with no Gatekeeper warning on a clean Mac.
#
# Usage:
#   FLOW_SIGN_IDENTITY="Developer ID Application: Jane Doe (AB12CD34EF)" \
#   FLOW_NOTARY_PROFILE="flow-notary" \
#   apps/macos/tools/dist.sh
#
# Env contract (§2 of the spec):
#   FLOW_SIGN_IDENTITY  Developer ID Application identity (required)
#   FLOW_NOTARY_PROFILE notarytool keychain profile name (required)
#   FLOW_SERVER_URL     server the build points at (optional; make-app.sh default)
#
# Runs identically locally and in CI. Holds no secrets — signing uses an
# identity already in the keychain, notarization a stored keychain profile.
# Never falls back to ad-hoc signing: a missing identity aborts the run, because
# an ad-hoc build cannot be notarized.
set -euo pipefail
cd "$(dirname "$0")/.."

fail() { echo "dist.sh: $*" >&2; exit 1; }

# --- Preflight: env + identity must be present before we build anything -------
[ -n "${FLOW_SIGN_IDENTITY:-}" ] || fail \
  "FLOW_SIGN_IDENTITY is unset. Set it to your Developer ID Application identity.
See docs/specs/phase14.md §2 for one-time credential setup."
[ -n "${FLOW_NOTARY_PROFILE:-}" ] || fail \
  "FLOW_NOTARY_PROFILE is unset. Set it to your notarytool keychain profile name.
See docs/specs/phase14.md §2 for one-time credential setup."

if ! security find-identity -p codesigning -v 2>/dev/null | grep -qF "$FLOW_SIGN_IDENTITY"; then
  fail "signing identity not found in keychain:
  $FLOW_SIGN_IDENTITY
Install the Developer ID Application certificate (docs/specs/phase14.md §2)."
fi

ENTITLEMENTS="tools/Flow.entitlements"
[ -f "$ENTITLEMENTS" ] || fail "missing $ENTITLEMENTS"

APP="dist/Flow.app"
ZIP="dist/Flow.zip"
DMG="dist/Flow.dmg"

# --- 1. Release build + bundle (reuse make-app.sh so bundling never drifts) ---
echo "==> Building release bundle"
tools/make-app.sh release

# --- 2. Sign: hardened runtime + secure timestamp + entitlements --------------
echo "==> Signing with Developer ID under the hardened runtime"
codesign --force --options runtime --timestamp \
  --entitlements "$ENTITLEMENTS" \
  -s "$FLOW_SIGN_IDENTITY" "$APP"

# --- 3. Verify the signature before spending time uploading -------------------
echo "==> Verifying signature"
codesign --verify --deep --strict --verbose=2 "$APP"

# --- 4. Zip for submission (notarytool needs a container) ---------------------
echo "==> Packaging zip for notarization"
rm -f "$ZIP"
ditto -c -k --keepParent "$APP" "$ZIP"

# --- 5. Notarize, blocking on the verdict -------------------------------------
echo "==> Submitting to Apple notary service (waits for verdict)"
SUBMIT_JSON=$(xcrun notarytool submit "$ZIP" \
  --keychain-profile "$FLOW_NOTARY_PROFILE" \
  --wait --output-format json) || {
    echo "$SUBMIT_JSON" >&2
    fail "notarytool submit failed"
  }
echo "$SUBMIT_JSON"

SUBMISSION_ID=$(printf '%s' "$SUBMIT_JSON" | /usr/bin/plutil -extract id raw - 2>/dev/null || true)
STATUS=$(printf '%s' "$SUBMIT_JSON" | /usr/bin/plutil -extract status raw - 2>/dev/null || true)

if [ "$STATUS" != "Accepted" ]; then
  echo "==> Notarization did not succeed (status: ${STATUS:-unknown}); fetching log" >&2
  if [ -n "$SUBMISSION_ID" ]; then
    xcrun notarytool log "$SUBMISSION_ID" \
      --keychain-profile "$FLOW_NOTARY_PROFILE" >&2 || true
  fi
  fail "notarization rejected — see the log above (docs/specs/phase14.md §4 on entitlements)"
fi

# --- 6. Staple the ticket so the app validates offline ------------------------
echo "==> Stapling notarization ticket"
xcrun stapler staple "$APP"

# --- 7. Package the DMG for hand-off ------------------------------------------
echo "==> Building DMG"
rm -f "$DMG"
hdiutil create -volname Flow -srcfolder "$APP" -ov -format UDZO "$DMG"

# --- 8. Final gate check — what a fresh Mac will assess -----------------------
echo "==> Gatekeeper assessment"
spctl --assess --type execute --verbose "$APP"   # expect: accepted, source=Notarized Developer ID
xcrun stapler validate "$APP"

rm -f "$ZIP"
echo
echo "Done. Distributable: $DMG"
echo "  → download, open, drag Flow to /Applications, launch — no Gatekeeper prompt."
