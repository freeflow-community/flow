# Web: the workspace switcher moves into the sidebar menu (#565)

- `[web]` "Workspaces & servers…" is now a row in the sidebar's workspace
  drop-down, next to All Workspaces. The old entry was a button pinned to the
  bottom-right of the window, floating over the composer's send button — the
  same complaint #561/#563 fixed on iOS.
- `[web]` The sign-in screen and the workspace chooser get the same entry.
  Neither has a sidebar, so without it a signed-out or workspace-less visitor
  could not reach another server at all.
- `[qa]` `docs/qa/issue-542/acceptance-web.mjs` drives the new path and asserts
  no floating button remains. It also seeds its own A-ONLY/B-ONLY markers —
  they had been typed in by hand, so the script as committed could not run.

## Feature

- **Reach your other workspaces and servers from the workspace menu.** Click
  the workspace name at the top of the sidebar and pick "Workspaces & servers…"
  — the button that used to float in the bottom-right corner, on top of the
  message you were sending, is gone. The sign-in screen and the workspace
  picker have their own link to the same place.
