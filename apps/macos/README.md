# Flow macOS Client

SwiftUI client for the Phase 1 Flow backend.

## Requirements

- macOS 14+, Xcode 26 (Swift 6)
- Backend running locally: REST `http://127.0.0.1:8787`, WS `ws://127.0.0.1:8787/v1/ws`

## Run in Xcode

1. Open `Package.swift` in Xcode (File > Open… and pick this folder or the Package.swift file).
2. Wait for package resolution (GRDB).
3. Select the **Flow** scheme, destination **My Mac**, then Run (Cmd-R).

## Run from the command line

```sh
cd apps/macos
swift run Flow
```

## Tests

`swift test` runs a live-server smoke test against `127.0.0.1:8787` (creates throwaway accounts), verifying the API client decodes the real backend responses.

## Notes

- Local cache: SQLite (GRDB) at `~/Library/Application Support/Flow/flow.sqlite`. Channels and messages render instantly from cache and survive offline.
- Session token is stored in the Keychain.
- Invites: paste the `flow://invite/<token>` link (or just the token) into "Accept Invite…". The `.onOpenURL` deep-link handler is implemented, but the `flow://` URL scheme only gets registered with LaunchServices when the app is wrapped in a proper `.app` bundle (a bare SwiftPM executable has no Info.plist), so pasting is the reliable path in this setup.
