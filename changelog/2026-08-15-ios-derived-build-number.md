# iOS build numbers come from the commit count

- `[ios]` One command to cut a build: `apps/ios/tools/release-ios.sh` — archives,
  uploads to App Store Connect, and tags `ios-build-<n>` only after the upload
  succeeds.
- `[ios]` The build number is now `git rev-list --count HEAD`, passed to
  `xcodebuild`, matching what macOS already does for `CFBundleVersion`. Nothing
  in the repo is bumped per upload, so `project.yml` can no longer disagree with
  App Store Connect — it drifted five times in three days.
- `[ios]` `CURRENT_PROJECT_VERSION` in `project.yml` is now a fallback for local
  Xcode builds only.
