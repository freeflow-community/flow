# macOS workspace switcher moves into the workspace menu (#566)

- `[macos]` "Workspaces & servers…" moved out of the button floating at the
  bottom-right of the window — over the composer's send button — and into the
  sidebar's workspace drop-down, next to "All Workspaces". Matches iOS (#563)
  and web (#565).
- `[macos]` The sign-in screen and the workspace chooser have no sidebar, so
  each keeps its own entry; without them a signed-out window on the wrong
  server would be a dead end.

## Feature

- **On the Mac, switching workspace or server is in the workspace menu.** Click
  the workspace name at the top of the sidebar and choose "Workspaces &
  servers…". Nothing floats over the message box any more, and the sign-in and
  choose-a-workspace screens still have their own way to it.
