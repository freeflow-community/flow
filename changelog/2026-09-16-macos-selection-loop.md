# macOS: fix a request storm after switching connections

- [macos] Opening a workspace on another connection (the unified rail, #614) made every app-state change re-select that workspace and restart its full network load; the storm starved message sends. The window's initial selection now runs once, when SwiftUI creates the window state.
- [qa] `WindowStateTests.testSessionRootInitDoesNotSelectAWorkspace` (fails on the old init).

## Feature

- **Sending works again on the Mac after switching workspaces.** Switching to a Slack team or another server from the rail no longer slows the app to a halt.
