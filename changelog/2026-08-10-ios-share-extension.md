# iOS: Share to Flow — share extension for screenshots and links

- `[ios]` New `FlowShare` app-extension target: pick a channel, add a caption,
  Send, straight from the system share sheet. Images and URLs/text.
- `[ios]` `Keychain` now names an access group on iOS, so the extension reads
  the app's session token instead of looking signed out. The group is the app's
  own id, so existing tokens are already in it.
- `[ios]` The extension stamps its own `FlowServerURL`, with a build phase that
  fails the build if it goes missing — without it `Bundle.main` resolves to
  localhost and silently changes the Keychain account name.
- `[qa]` `ShareExtensionTests` drives Photos and Safari through the real share
  sheet; `apps/ios/tools/qa-share-extension.sh` sets it up. Must run against a
  remote server — localhost hides the bug above.

## Feature

- **Share to Flow from anywhere on your iPhone.** Screenshots, photos and links
  now go straight into a channel from the share sheet, with an optional caption
  and no trip through the app. The channel you used last is already selected.
