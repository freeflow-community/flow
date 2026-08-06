# macOS windows navigate independently

- `[macos]` Each ⌘N window now owns its selection (workspace, channel, thread,
  artifact, Activity) in a per-window `WindowState`; the shared `AppState` had
  made every window mirror the same selection. `AppState` keeps a registry of
  windows and answers the aggregate questions: "seen" now means visible in
  *any* active window, workspace-scoped events apply to every open workspace,
  and artifacts + Activity badges are keyed per workspace.
- `[macos]` OS banner taps and accepted invites navigate the key window.
- `[qa]` `WindowStateTests` covers independent selection, cross-window
  read/banner gating, per-workspace badges, and closed-window teardown.
- `[macos]` VERSION 2.2.19.

## Feature

- **Two Flow windows, two conversations.** Open a second window with ⌘N on the
  Mac and use it independently — different workspace, channel, or thread in
  each window. Windows used to mirror each other; now they don't.
