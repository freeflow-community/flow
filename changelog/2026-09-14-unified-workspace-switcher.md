# Slack teams and other servers in the same workspace list (web)

- [web] The sidebar workspace menu and the Choose a Workspace screen list every connection's workspaces — Slack teams and other Flow servers included — and picking one switches to its connection.
- [web] Workspaces & servers shows each Slack team as a card in the server list; Connect Slack moves to its own section below.
- [qa] `lib/workspaceSwitcher.test.ts`; fake-connector screenshots in `docs/qa/unified-switcher/`.

## Feature

- **One list for all your workspaces.** On the web, the workspace menu and the workspace chooser now show your Slack teams and workspaces from your other Flow servers next to the ones you are in, so you can jump straight to any of them.
