# Help: What's New and a Huddles guide (#474)

- `[server]` The help topic list gains a generated page, `whats-new`, built
  from `scripts/build-features.mjs` — the same source as the build version
  menu's FEATURES.md, so the two cannot drift and a release note is written
  once. Falls back to the built FEATURES.md; a checkout with neither doesn't
  advertise the topic, so the sidebar never offers a page that 404s.
- `[server]` `scripts/build-features.mjs` now exports `buildFeatures()` and
  keeps writing FEATURES.md when run as a CLI.
- New `docs/help/huddles.md`: starting/joining in channels and DMs, mic,
  camera, screen share, and the OS permission paths — including that macOS
  screen sharing needs Screen & System Audio Recording, separately from
  mic/camera.
- `[macos]` The help viewer folds a bullet's soft-wrapped continuation lines,
  as the version menu and the web viewer already did. Without it every wrapped
  bullet rendered as a bullet plus a stray paragraph — and the What's New page
  is generated from FEATURES.md, whose bullets are always wrapped, so no
  authoring could avoid it.

## Feature

- **Help has a What's New page.** The release notes from the build menu are now
  a page in Help, so you can read what changed without hunting for them.
- **Help has a Huddles guide.** How to start, join and leave a huddle, use your
  mic, camera and screen share, and what to do when your Mac or browser won't
  let Flow use the microphone or camera.
