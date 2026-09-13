# iOS workspace switcher moves to the sidebar header (#563)

- `[ios]` "Workspaces & servers…" moved out of the composer's `+` menu and into
  the sidebar's workspace header menu — the `+` is for composing, and
  workspace-level navigation belongs where the rest of it lives (#561 parked it
  there; follow-up feedback moved it).
- `[ios]` The sidebar header now names the server under the workspace, so the
  row says which connection you are on before you open the switcher (#542).
- `[ios]` The `+` menu keeps #562's fix — always a menu, with the
  attachments-unavailable reason on a disabled row — and the sign-in screen
  keeps its own switcher entry, since it has no sidebar.
- `[macos]` `ServerConnection.displayLabel` holds the one rule for naming a
  connection, so the switcher sheet and the new sidebar line can't drift.

## Feature

- **The workspace and server switcher is at the top of the sidebar.** Tap the
  workspace name to reach every workspace and server you're signed in to — the
  same place the workspace name already lives, and the server you're on is now
  printed right under it.
