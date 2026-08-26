# Workspaces joined in another session appear live everywhere

- `[server]` Gateway now forwards `workspace.joined` to the user's other
  connected sockets (it was consumed internally only), so every session learns
  about the new workspace.
- `[macos]` `[ios]` Handle `workspace.joined`: refresh the workspace list so
  the new workspace shows up without a restart.
- `[web]` Other open tabs refresh their workspace list on `workspace.joined`.

## Feature

- **New workspaces appear on all your devices right away.** When you accept a
  workspace invite on one device, the workspace now shows up immediately in
  your other open apps and tabs — no restart needed.
