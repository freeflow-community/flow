#!/bin/bash
# Cut a macOS release. One command, from the repo root:
#
#   apps/macos/tools/release-macos.sh              # patch bump  (2.2.24 -> 2.2.25)
#   apps/macos/tools/release-macos.sh --minor      # minor bump  (2.2.24 -> 2.3.0)
#   apps/macos/tools/release-macos.sh --major      # major bump  (2.2.24 -> 3.0.0)
#   apps/macos/tools/release-macos.sh 2.5.0        # explicit version
#   apps/macos/tools/release-macos.sh --dry-run    # print the plan, build nothing
#
# THE VERSION COMES FROM WHAT IS PUBLISHED, NOT FROM A FILE IN THE REPO.
#
# We used to bump apps/macos/VERSION inside every PR that touched apps/macos/**.
# That records an intention, not a fact, and it failed twice in one day:
#
#   - Two PRs both bumped to 2.2.24. The second merged as a silent no-op,
#     because the first had already written that value. It looked like a bump.
#   - 2.2.24 shipped code from three PRs, so the file said who edited it last
#     and nothing about what was inside the release.
#
# So this script asks the appcast — the thing users actually update from — what
# the last shipped version was, adds one, and tags the commit it built. The tag
# is then the only record that matters: it names the version AND the commit.
#
# CFBundleVersion is unchanged: make-app.sh still uses `git rev-list --count`,
# which is already derived and already monotonic. This script only supplies the
# marketing version, via FLOW_APP_VERSION (see make-app.sh).
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
WEB_URL=${FLOW_WEB_URL:-https://app.freeflow.im}
APPCAST_URL=${FLOW_APPCAST_URL:-"$WEB_URL/download/mac/appcast.xml"}
TAG_PREFIX=macos-v

fail() { echo "release-macos: $*" >&2; exit 1; }
note() { echo "==> $*"; }

# --- Args --------------------------------------------------------------------
BUMP=patch
EXPLICIT=""
DRY_RUN=0
ASSUME_YES=0
for arg in "$@"; do
  case "$arg" in
    --patch) BUMP=patch ;;
    --minor) BUMP=minor ;;
    --major) BUMP=major ;;
    --dry-run) DRY_RUN=1 ;;
    --yes|-y) ASSUME_YES=1 ;;
    -*) fail "unknown flag: $arg" ;;
    *) EXPLICIT="$arg" ;;
  esac
done

# --- Refuse to ship from a state you can't reason about later ----------------
# A release is the one moment where "which commit is this?" must have an exact
# answer. A dirty tree or a stale branch makes the tag a lie.
cd "$REPO_ROOT"
BRANCH=$(git rev-parse --abbrev-ref HEAD)
[ "$BRANCH" = "main" ] || fail "on branch '$BRANCH' — releases are cut from main."
[ -z "$(git status --porcelain)" ] || fail "working tree is dirty. Commit or stash first."
git fetch origin --quiet --tags
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)
[ "$LOCAL" = "$REMOTE" ] || fail "main is not in sync with origin/main. Pull (or push) first."

# --- What is actually published today? ---------------------------------------
note "Reading the live appcast: $APPCAST_URL"
APPCAST=$(curl -fsSL "$APPCAST_URL") || fail "could not fetch the appcast. Check the network and $APPCAST_URL."
LIVE=$(printf '%s' "$APPCAST" \
  | grep -o '<sparkle:shortVersionString>[^<]*' \
  | sed 's/.*>//' \
  | sort -V | tail -1)
[ -n "$LIVE" ] || fail "no <sparkle:shortVersionString> in the appcast — refusing to guess a version."
note "Live version: $LIVE"

# --- Next version -------------------------------------------------------------
if [ -n "$EXPLICIT" ]; then
  NEXT="$EXPLICIT"
  printf '%s' "$NEXT" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' \
    || fail "'$NEXT' is not MAJOR.MINOR.PATCH."
  # An explicit version still has to move forwards, or Sparkle will not offer it.
  HIGHEST=$(printf '%s\n%s\n' "$LIVE" "$NEXT" | sort -V | tail -1)
  [ "$HIGHEST" = "$NEXT" ] && [ "$NEXT" != "$LIVE" ] \
    || fail "$NEXT is not greater than the live version $LIVE."
else
  IFS=. read -r MA MI PA <<<"$LIVE"
  case "$BUMP" in
    patch) PA=$((PA + 1)) ;;
    minor) MI=$((MI + 1)); PA=0 ;;
    major) MA=$((MA + 1)); MI=0; PA=0 ;;
  esac
  NEXT="$MA.$MI.$PA"
fi
TAG="$TAG_PREFIX$NEXT"

git rev-parse -q --verify "refs/tags/$TAG" >/dev/null \
  && fail "tag $TAG already exists. Pick another version, or delete the tag if it was a mistake."

# --- What is going out --------------------------------------------------------
LAST_TAG=$(git tag -l "$TAG_PREFIX*" | sort -V | tail -1)
echo
note "Releasing $NEXT (was $LIVE) from $(git rev-parse --short HEAD)"
if [ -n "$LAST_TAG" ]; then
  COUNT=$(git rev-list --count "$LAST_TAG..HEAD")
  echo "    $COUNT commit(s) since $LAST_TAG:"
  git log --oneline "$LAST_TAG..HEAD" | sed 's/^/      /'
else
  echo "    No previous $TAG_PREFIX* tag — this is the first tagged release."
  echo "    Recent commits:"
  git log --oneline -8 | sed 's/^/      /'
fi
echo "    Tag to create: $TAG"
echo

if [ "$DRY_RUN" = 1 ]; then
  note "Dry run — nothing built, nothing tagged, nothing uploaded."
  exit 0
fi

# --- Confirm ------------------------------------------------------------------
# This uploads to R2 and every existing install is offered the result, so the
# default is to ask. --yes is for a caller that has already decided.
if [ "$ASSUME_YES" != 1 ]; then
  [ -t 0 ] || fail "not a terminal — pass --yes if you mean to publish unattended."
  read -r -p "Build, notarize and publish $NEXT? [y/N] " reply
  case "$reply" in [yY]*) ;; *) fail "cancelled." ;; esac
fi

# --- Build, sign, notarize, publish -------------------------------------------
# publish-dmg.sh --build runs the whole chain and uploads the DMG, the update
# archive, the deltas and the signed appcast. FLOW_APP_VERSION overrides the
# VERSION file inside make-app.sh, which is what makes this tag-driven.
note "Building and publishing $NEXT"
FLOW_APP_VERSION="$NEXT" "$REPO_ROOT/apps/macos/tools/publish-dmg.sh" --build

# --- Tag it, but only now that it shipped -------------------------------------
# The tag is created AFTER a successful publish so a tag always means "this
# commit is live", never "someone tried".
note "Tagging $TAG"
git tag -a "$TAG" -m "macOS $NEXT"
git push origin "$TAG"

echo
note "Done. $NEXT is live at $WEB_URL/download/mac"
echo "      Update feed: $WEB_URL/download/mac/appcast.xml"
echo "      Tag:         $TAG -> $(git rev-parse --short HEAD)"
