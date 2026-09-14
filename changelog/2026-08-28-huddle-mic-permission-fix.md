# Voice huddle: fix unmute silently failing with mic access never granted

- `[macos]` `[ios]` Unmuting in a huddle now calls LiveKit's
  `ensureDeviceAccess` before opening the mic. Previously nothing in the app
  requested OS mic permission at all, so the native audio engine failed with
  a generic "permission not granted" error, the system consent dialog never
  appeared, and Flow never showed up in System Settings → Privacy & Security
  → Microphone (macOS) / Settings → Flow (iOS) for the user to grant it.
- `[macos]` `[ios]` A denied/undetermined mic permission now shows a
  dedicated alert with an "Open Settings" button that deep-links straight to
  the right settings screen.

## Feature

- **Fixed:** turning your mic on in a huddle now properly asks for
  microphone permission (and shows up in your Mac/iPhone's privacy settings)
  instead of silently failing.
