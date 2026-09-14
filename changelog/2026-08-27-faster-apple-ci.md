# Faster Apple client CI

- [qa] Split the `Apple client validation` workflow into parallel macOS and
  iOS jobs and cache compiled Swift dependencies; also runs on pushes to
  `main` (path-filtered) to seed the caches PRs restore from. ~10 min → ~3-6.
- [qa] PRs that touch neither `apps/macos/` nor `apps/ios/` skip the mac jobs
  entirely (job-level path filter, so the checks still report as skipped).
