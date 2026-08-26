# changelog/ — one file per change

Every feature or fix PR adds **one new file** here instead of appending to a
shared ledger. Two PRs can never conflict, because no two PRs touch the same
file. This replaced appending to `CHANGELOG.md` on 2026-08-06 (see
`decision_log.md`); the old appended history is frozen in the repo-root
`CHANGES_ARCHIVE_*.log` files.

## File name

`YYYY-MM-DD-short-slug.md` — today's date plus a short unique kebab-case name,
e.g. `2026-08-07-pinned-messages.md`. The date prefix is what the generator
groups by. Files not matching this pattern (this README, `FEATURES_ARCHIVE.md`)
are ignored by the generator.

## Format

```markdown
# One-line title of the change

- `[server]` `[web]` What changed, one or two lines, same succinct style and
  platform tags as before: `[server]` `[web]` `[macos]` `[ios]` `[bridge]`
  `[qa]`.
- Another bullet if needed.

## Feature

- **Friendly bold lead.** What a user can now do, in plain language — no
  platform tags, file names, or other internals. Mention a platform only when
  the change is specific to it.
```

The `## Feature` section is what lands in the generated `FEATURES.md`. **Omit
the whole section for purely internal changes** (refactors, tests, infra,
build plumbing) — those get changelog bullets here but nothing user-facing.

Rules carried over from the old protocol:

- Keep bullets very succinct. Reasoning and investigation notes belong in the
  commit message, not here.
- A change that lands on one client but not the others must still add a line
  to the **Parity** section of `CHANGELOG.md`.
- Never edit another PR's entry file. Fixing a typo in an old entry is fine in
  its own small PR.

## Generated output

`FEATURES.md` (repo root) is **generated** — never edit it by hand; it is
gitignored and rebuilt on every web predev/prebuild and by
`apps/macos/tools/make-app.sh`. To rebuild it manually:

```sh
node scripts/build-features.mjs
```

The generator collects the `## Feature` sections from the entry files, groups
them by date (newest first), and appends `FEATURES_ARCHIVE.md` — the
hand-written FEATURES.md as it stood on 2026-08-06, frozen verbatim.
