#!/bin/bash
# Publish the notarized macOS DMG to R2 so https://app.freeflow.im/download/mac
# serves it. Re-run whenever the DMG changes — overwriting the object ships the
# new build with no code deploy (the /download/mac route always presigns the
# current object). See docs/ops/DEPLOYMENT.md § macOS app download.
#
# Reads R2 credentials from an env file (default: repo-root .env), which must
# define the same vars the server uses:
#   CLOUDFLARE_S3_ENDPOINT, CLOUDFLARE_ACCESS_KEY_ID, CLOUDFLARE_SECRET_ACCESS_KEY
#   FLOW_R2_BUCKET (optional; defaults to flow-files)
# Already-exported shell vars win over the file, so this also works in CI.
#
# Usage:
#   apps/macos/tools/publish-dmg.sh            # upload apps/macos/dist/Flow.dmg
#   apps/macos/tools/publish-dmg.sh --build    # run dist.sh first, then upload
#   apps/macos/tools/publish-dmg.sh path/to/Flow.dmg
#   ENV_FILE=other/.env apps/macos/tools/publish-dmg.sh
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
ENV_FILE=${ENV_FILE:-"$REPO_ROOT/.env"}
BUCKET=${FLOW_R2_BUCKET:-flow-files}
KEY=${FLOW_DMG_KEY:-downloads/Flow.dmg}
WEB_URL=${FLOW_WEB_URL:-https://app.freeflow.im}

fail() { echo "publish-dmg: $*" >&2; exit 1; }

# --- Parse args: optional --build, optional DMG path --------------------------
BUILD=0
DMG=""
for arg in "$@"; do
  case "$arg" in
    --build) BUILD=1 ;;
    -*) fail "unknown flag: $arg" ;;
    *) DMG="$arg" ;;
  esac
done
DMG=${DMG:-"$REPO_ROOT/apps/macos/dist/Flow.dmg"}

# --- Optionally (re)build the notarized DMG -----------------------------------
if [ "$BUILD" = 1 ]; then
  echo "==> Building notarized DMG (dist.sh)"
  FLOW_SIGN_IDENTITY=${FLOW_SIGN_IDENTITY:-"Developer ID Application: BizTrip AI Inc. (76NSMTH84G)"} \
  FLOW_NOTARY_PROFILE=${FLOW_NOTARY_PROFILE:-flow-notary} \
    "$REPO_ROOT/apps/macos/tools/dist.sh"
fi

# --- Credentials: prefer shell env, fall back to the env file -----------------
# Read a single KEY=value from ENV_FILE, keeping everything after the first '='
# (base64 secrets contain '=') and stripping one layer of surrounding quotes.
load_var() {
  [ -f "$ENV_FILE" ] || return 1
  local line val
  line=$(grep -E "^$1=" "$ENV_FILE" | tail -1) || return 1
  [ -n "$line" ] || return 1
  val=${line#*=}
  val=${val%\"}; val=${val#\"}
  val=${val%\'}; val=${val#\'}
  printf '%s' "$val"
}

ENDPOINT=${CLOUDFLARE_S3_ENDPOINT:-$(load_var CLOUDFLARE_S3_ENDPOINT || true)}
R2_KEY=${CLOUDFLARE_ACCESS_KEY_ID:-$(load_var CLOUDFLARE_ACCESS_KEY_ID || true)}
R2_SECRET=${CLOUDFLARE_SECRET_ACCESS_KEY:-$(load_var CLOUDFLARE_SECRET_ACCESS_KEY || true)}

# --- Preflight ----------------------------------------------------------------
command -v aws >/dev/null 2>&1 || fail "the AWS CLI ('aws') is not installed (brew install awscli)"
[ -f "$DMG" ] || fail "DMG not found: $DMG
Build it first: apps/macos/tools/dist.sh   (or pass --build)"
[ -n "$ENDPOINT" ]  || fail "CLOUDFLARE_S3_ENDPOINT not set (checked env and $ENV_FILE)"
[ -n "$R2_KEY" ]    || fail "CLOUDFLARE_ACCESS_KEY_ID not set (checked env and $ENV_FILE)"
[ -n "$R2_SECRET" ] || fail "CLOUDFLARE_SECRET_ACCESS_KEY not set (checked env and $ENV_FILE)"
# R2 access keys are 32 hex chars; a 20-char AKIA… means a stray AWS key leaked in.
[ "${#R2_KEY}" = 32 ] || echo "publish-dmg: warning: R2 access key is ${#R2_KEY} chars (expected 32) — is this really the R2 key?" >&2

echo "==> Uploading $(du -h "$DMG" | cut -f1) → s3://$BUCKET/$KEY"

# Upload helper (same credential mapping as the DMG upload below).
r2_cp() {
  AWS_ACCESS_KEY_ID="$R2_KEY" \
  AWS_SECRET_ACCESS_KEY="$R2_SECRET" \
  AWS_DEFAULT_REGION=auto \
  AWS_REQUEST_CHECKSUM_CALCULATION=when_required \
  AWS_RESPONSE_CHECKSUM_VALIDATION=when_required \
  aws s3 cp "$1" "s3://$BUCKET/$2" --endpoint-url "$ENDPOINT" --content-type "$3"
}

# Map the R2 creds onto the names the AWS CLI actually reads (it ignores
# CLOUDFLARE_*), scoped to this one command. AWS_*_CHECKSUM_* opt out of the
# CLI v2 default integrity checksums, which R2 rejects as unimplemented.
AWS_ACCESS_KEY_ID="$R2_KEY" \
AWS_SECRET_ACCESS_KEY="$R2_SECRET" \
AWS_DEFAULT_REGION=auto \
AWS_REQUEST_CHECKSUM_CALCULATION=when_required \
AWS_RESPONSE_CHECKSUM_VALIDATION=when_required \
aws s3 cp "$DMG" "s3://$BUCKET/$KEY" \
  --endpoint-url "$ENDPOINT" \
  --content-type application/x-apple-diskimage

# --- Sparkle feed: how EXISTING installs learn about this build ---------------
# The DMG only serves new downloads. Skipping this ships a build nobody already
# running Flow will ever be offered, so it's a loud warning, not a silent pass.
UPDATES_DIR=$(cd "$(dirname "$DMG")" && pwd)/updates
if [ -f "$UPDATES_DIR/appcast.xml" ]; then
  # Archives first, then the feed: the feed names them, so publishing it first
  # opens a window where an update is announced but 404s.
  for zip in "$UPDATES_DIR"/Flow-*.zip; do
    [ -e "$zip" ] || continue
    echo "==> Uploading $(basename "$zip") ($(du -h "$zip" | cut -f1))"
    r2_cp "$zip" "downloads/mac/$(basename "$zip")" application/zip
  done
  echo "==> Uploading appcast.xml"
  r2_cp "$UPDATES_DIR/appcast.xml" "downloads/mac/appcast.xml" application/xml
else
  echo
  echo "WARNING: no $UPDATES_DIR/appcast.xml — this build ships to new downloads only." >&2
  echo "         Existing installs will not be offered it. Run dist.sh to generate the feed." >&2
fi

echo
echo "Done. Live at: $WEB_URL/download/mac"
[ -f "$UPDATES_DIR/appcast.xml" ] && echo "      Update feed: $WEB_URL/download/mac/appcast.xml"
