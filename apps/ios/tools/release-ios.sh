#!/bin/bash
# Archive the iOS app and upload it to App Store Connect. One command, from the
# repo root:
#
#   apps/ios/tools/release-ios.sh              # build from the commit count
#   apps/ios/tools/release-ios.sh --dry-run    # print the plan, build nothing
#   apps/ios/tools/release-ios.sh 412          # explicit build number (escape hatch)
#
# THE BUILD NUMBER IS DERIVED FROM THE COMMIT COUNT, NOT AUTHORED IN A FILE.
#
# We used to bump CURRENT_PROJECT_VERSION in apps/ios/project.yml per upload.
# That records an intention, not a fact, and it drifted five times in three
# days: builds 23, 24, 25, 26 and 28 were all uploaded while their bumps sat on
# unmerged branches, so main claimed 23 when App Store Connect already held 28.
# Every drift ended the same way — an upload rejected for a re-used number, or a
# bookkeeping PR that would have moved main *backwards* if merged.
#
# The number a release needs is "one more than the last one", and the repo
# cannot see the server that owns it. So stop asking the repo. `git rev-list
# --count HEAD` is monotonic, needs no credentials, and is already what
# apps/macos/tools/make-app.sh uses for the macOS CFBundleVersion — this makes
# iOS match. It is passed to xcodebuild as a command-line build setting, which
# outranks the project, so both the app and its share extension get it and no
# file in the repo changes.
#
# CURRENT_PROJECT_VERSION in project.yml is now only a fallback for local Xcode
# builds. Leave it alone.
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
PROJECT="$REPO_ROOT/apps/ios/FlowiOS.xcodeproj"
ARCHIVE=${FLOW_IOS_ARCHIVE:-/tmp/FlowiOS.xcarchive}
EXPORT_OPTS="$REPO_ROOT/apps/ios/ExportOptions.plist"
TAG_PREFIX=ios-build-

fail() { echo "release-ios: $*" >&2; exit 1; }
note() { echo "==> $*"; }

# --- Args --------------------------------------------------------------------
DRY_RUN=0
ASSUME_YES=0
EXPLICIT=""
ALLOW_DIRTY=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --yes|-y) ASSUME_YES=1 ;;
    --allow-dirty) ALLOW_DIRTY=1 ;;
    -*) fail "unknown flag: $arg" ;;
    *) EXPLICIT="$arg" ;;
  esac
done

# --- Refuse to ship from a state you can't reason about later ----------------
cd "$REPO_ROOT"
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$ALLOW_DIRTY" != 1 ]; then
  [ "$BRANCH" = "main" ] || fail "on branch '$BRANCH' — releases are cut from main (--allow-dirty to override)."
  [ -z "$(git status --porcelain)" ] || fail "working tree is dirty. Commit or stash first."
  git fetch origin --quiet
  [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] \
    || fail "main is not in sync with origin/main. Pull (or push) first."
fi

# --- The build number ---------------------------------------------------------
if [ -n "$EXPLICIT" ]; then
  printf '%s' "$EXPLICIT" | grep -Eq '^[0-9]+$' || fail "'$EXPLICIT' is not a whole number."
  BUILD="$EXPLICIT"
else
  BUILD=$(git rev-list --count HEAD)
fi
MARKETING=$(grep -m1 'MARKETING_VERSION:' apps/ios/project.yml | sed 's/.*: *"\{0,1\}//; s/"//')
TAG="$TAG_PREFIX$BUILD"

echo
note "Releasing $MARKETING ($BUILD) from $(git rev-parse --short HEAD)"
LAST_TAG=$(git tag -l "$TAG_PREFIX*" | sort -V | tail -1)
if [ -n "$LAST_TAG" ]; then
  echo "    $(git rev-list --count "$LAST_TAG..HEAD") commit(s) since $LAST_TAG:"
  git log --oneline "$LAST_TAG..HEAD" | sed 's/^/      /'
else
  echo "    No previous $TAG_PREFIX* tag — recent commits:"
  git log --oneline -8 | sed 's/^/      /'
fi
echo "    Tag to create: $TAG"
echo

if [ "$DRY_RUN" = 1 ]; then
  note "Dry run — nothing built, nothing uploaded."
  exit 0
fi

if [ "$ASSUME_YES" != 1 ]; then
  [ -t 0 ] || fail "not a terminal — pass --yes if you mean to upload unattended."
  read -r -p "Archive and upload $MARKETING ($BUILD) to App Store Connect? [y/N] " reply
  case "$reply" in [yY]*) ;; *) fail "cancelled." ;; esac
fi

# --- Generate, archive, upload ------------------------------------------------
# The Xcode project is generated, not committed.
note "Generating the Xcode project"
xcodegen generate --spec apps/ios/project.yml --project apps/ios

# App Store Connect may already hold this number — it has run ahead of the repo
# before. Bump and retry rather than making a human read the rejection.
MAX_TRIES=4
for try in $(seq 1 $MAX_TRIES); do
  note "Archiving $MARKETING ($BUILD)  [attempt $try]"
  rm -rf "$ARCHIVE"
  # CURRENT_PROJECT_VERSION on the command line outranks the project, and applies
  # to every target — the app and the share extension must carry the same value
  # or the archive is rejected.
  xcodebuild -project "$PROJECT" \
    -scheme Flow \
    -configuration Release \
    -destination 'generic/platform=iOS' \
    -archivePath "$ARCHIVE" \
    -allowProvisioningUpdates \
    CURRENT_PROJECT_VERSION="$BUILD" \
    archive || fail "archive failed."

  note "Exporting and uploading"
  set +e
  out=$(xcodebuild -exportArchive \
    -archivePath "$ARCHIVE" \
    -exportOptionsPlist "$EXPORT_OPTS" \
    -allowProvisioningUpdates 2>&1)
  rc=$?
  set -e
  printf '%s\n' "$out" | tail -40

  if [ $rc -eq 0 ]; then
    note "Uploaded $MARKETING ($BUILD)"
    break
  fi

  if printf '%s' "$out" | grep -qi "already been used\|previously used\|bundle version must be higher\|redundant binary"; then
    BUILD=$((BUILD + 1))
    TAG="$TAG_PREFIX$BUILD"
    note "App Store Connect already holds that number — retrying with $BUILD"
    [ "$try" = "$MAX_TRIES" ] && fail "still clashing after $MAX_TRIES attempts."
    continue
  fi

  fail "upload failed, and not because of the build number."
done

# --- Tag it, but only now that it uploaded ------------------------------------
# The tag is created AFTER a successful upload so a tag always means "this
# commit is on App Store Connect", never "someone tried".
note "Tagging $TAG"
git tag -a "$TAG" -m "iOS $MARKETING ($BUILD)"
git push origin "$TAG"

echo
note "Done. $MARKETING ($BUILD) is uploaded and processing."
echo "      Tag: $TAG -> $(git rev-parse --short HEAD)"
echo "      TestFlight shows it once processing finishes (a few minutes)."
echo
echo "      Shipping to the App Store is a separate act: attach this build to"
echo "      the version in App Store Connect and submit. Uploading does not."
