# Faster Apple client CI

- [qa] Split the `Apple client validation` workflow into parallel macOS and
  iOS jobs and cache compiled Swift dependencies; also runs on pushes to
  `main` (path-filtered) to seed the caches PRs restore from. ~10 min → ~3-6.
