#!/usr/bin/env bash
# Scaffold this PR's changelog/ entry, with the client-impact checklist filled in.
#
# CLAUDE.md's rule is one new file per PR, never an edit to another PR's — that
# is what makes concurrent PRs conflict-free — and a shipped change without one
# fails the QA close-out. The friction is remembering the filename convention,
# the platform tags, and which bits are optional; this writes the shape and
# leaves the thinking.
#
# Usage:
#   scripts/new-changelog.sh <issue-or-slug> <title…>
#
#   scripts/new-changelog.sh 465 "iOS Banners shim keeps the sound argument"
#     → changelog/2026-09-02-465-ios-banners-shim-keeps-the-sound-argument.md
#   scripts/new-changelog.sh dev-tooling "QA stack, cross-client check, push sim"
#     → changelog/2026-09-02-dev-tooling-qa-stack-cross-client-check-push-sim.md
#
#   --feature   include the `## Feature` section (user-visible change)
#   --print     write to stdout instead of to a file
#   --force     overwrite an existing file of the same name
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

FEATURE=0
PRINT=0
FORCE=0
POSITIONAL=()
for arg in "$@"; do
  case "$arg" in
    --feature) FEATURE=1 ;;
    --print) PRINT=1 ;;
    --force) FORCE=1 ;;
    -h|--help) sed -n '2,22p' "${BASH_SOURCE[0]}" | sed 's|^# \{0,1\}||'; exit 0 ;;
    *) POSITIONAL+=("$arg") ;;
  esac
done

if [ "${#POSITIONAL[@]}" -lt 2 ]; then
  echo "usage: scripts/new-changelog.sh [--feature] <issue-or-slug> <title…>" >&2
  exit 2
fi

REF="${POSITIONAL[0]}"
TITLE="${POSITIONAL[*]:1}"

slugify() {
  printf '%s' "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//' \
    | cut -c1-60 \
    | sed -E 's/-+$//'
}

DATE="$(date +%Y-%m-%d)"
SLUG="$(slugify "$REF-$TITLE")"
FILE="$ROOT/changelog/$DATE-$SLUG.md"

# An issue number in the title line is the one thing a reader wants first —
# every other tool in this repo keys off it.
if [[ "$REF" =~ ^[0-9]+$ ]]; then
  HEADING="$TITLE (#$REF)"
else
  HEADING="$TITLE"
fi

read -r -d '' BODY <<EOF || true
# $HEADING

- \`[server]\` \`[web]\` \`[macos]\` \`[ios]\` \`[bridge]\` \`[qa]\` …one or two
  lines: what changed, and the why only when it isn't obvious from the what.
- …another bullet if needed.
EOF

if [ "$FEATURE" = 1 ]; then
  BODY="$BODY

## Feature

- **Friendly bold lead.** What someone can now do or will notice, written for
  users — no platform tags, file names or migrations. Name a platform only when
  the change is specific to it.
"
else
  BODY="$BODY
"
fi

BODY="$BODY
<!-- Keep only the platform tags that apply, and delete this comment.
     Add a \`## Feature\` section (scripts/new-changelog.sh --feature) only if
     the change is user-visible; FEATURES.md is generated from those sections.

     Paste into the PR description, ticking every surface where a person or an
     agent can see a difference — all four unticked is a legitimate answer:

     Visible impact:
     - [ ] web client
     - [ ] macOS client
     - [ ] iOS client
     - [ ] agent bridge
-->"

if [ "$PRINT" = 1 ]; then
  printf '%s\n' "$BODY"
  exit 0
fi

if [ -e "$FILE" ] && [ "$FORCE" != 1 ]; then
  echo "new-changelog: $FILE already exists (use --force to overwrite)" >&2
  exit 1
fi

mkdir -p "$ROOT/changelog"
printf '%s\n' "$BODY" >"$FILE"
echo "${FILE#"$ROOT/"}"
