# macOS: huddle mic and camera could never be granted on a released build

- `[macos]` Added `com.apple.security.device.audio-input` and
  `com.apple.security.device.camera` to `tools/Flow.entitlements`. The release
  signs with the hardened runtime, which refuses both *before* TCC is
  consulted when the entitlements are absent — no consent prompt, no row in
  Privacy & Security, `requestAccess` false in 4ms. `make-app.sh` doesn't apply
  the hardened runtime, so every local build worked and every shipped one
  didn't (#469).
- `[macos]` `dist.sh` now asserts, on the *signed* bundle, that both
  entitlements survived `codesign` and that both `NS*UsageDescription` keys are
  present — a missing entitlement is silent at build time and unreproducible
  locally, so the release path is the only place it can be caught.
- `[macos]` `[ios]` New `DeviceAccess.request(_:)` replaces
  `LiveKitSDK.ensureDeviceAccess` at the mic and camera call sites. The SDK
  helper flattens every outcome to one `Bool`, which is how a refusal the user
  never saw got reported as one they chose; the "Access Needed → Open Settings"
  alert now fires only on a settled `.denied`/`.restricted`.

## Feature

- **Turning on your mic or camera in a huddle now asks you for permission.**
  On a released Mac build it used to fail on the spot, with a message pointing
  at a Privacy setting that Flow was never listed in — so there was no way to
  grant it. macOS now shows its normal permission prompt, and Flow appears in
  System Settings → Privacy & Security alongside your other apps.
