# Changelog moves to one file per PR; FEATURES.md is generated

- `[qa]` New `changelog/` directory: every feature/fix PR adds its own
  `YYYY-MM-DD-slug.md` entry file instead of appending to CHANGELOG.md, so
  concurrent PRs can no longer conflict on the ledgers. CHANGELOG.md keeps
  only the Parity ledger; its history is frozen in
  `CHANGES_ARCHIVE_PHASE17.log`.
- `[web]` `[macos]` `FEATURES.md` is now generated (and gitignored):
  `scripts/build-features.mjs` collects the entries' `## Feature` sections
  plus the frozen `changelog/FEATURES_ARCHIVE.md`. Runs on web
  predev/prebuild and in `make-app.sh`, so both "What's new" surfaces ship
  the same generated file.
