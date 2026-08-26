# macOS releases are tag-driven, and versions come from the live appcast

- `[macos]` New `apps/macos/tools/release-macos.sh`: reads the published
  appcast for the current version, bumps it, builds and publishes that commit,
  then tags it `macos-v<version>` only after the upload succeeds.
- `[macos]` Feature PRs no longer bump `apps/macos/VERSION` — it is now just a
  local-build fallback. Bumping in PRs recorded an intention, not a fact: two
  PRs wrote the same 2.2.24 and the second merged as a silent no-op.
