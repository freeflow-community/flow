# Slack provider step 3: WorkspaceBackend adapter and public-API chat baseline

- [server] Shared `WorkspaceBackend` contract (TypeScript + Swift): capability tri-state with reasons, normalized models, event stream, Slack identity helpers that keep `ts` verbatim.
- [server] Connector gains the public-API baseline behind the grant: conversations, members, history/replies with cursors, edit, delete, reactions, read mark, search, a per-team rate budget shared across sessions, Events API chat events routed per grant, `Retry-After` exposed over CORS; one normalizer serves all clients.
- [web] Every runtime owns a backend (`FlowBackend`, `SlackBackend`); chat-core hooks call it, Flow-only hooks are disabled on other providers, and controls render only when their capability is usable, with the backend's reason.
- [web] Slack teams open from the switcher: channels, DMs, history shown as limited with the Retry-After wait, threads, send/edit/delete as yourself, files and unrenderable blocks open in Slack, live updates from the connector stream.
- [macos] [ios] Native `SlackBackend` over the connector, `addSlackConnection` in the registry with per-team bindings, the emoji shortcode table; unit-tested on both. Sign-in and view wiring remain a Parity item.
- [qa] `docs/qa/issue-545`: the real connector against a fake Slack, driven headless with screenshots; connector, web and native suites extended.

## Feature

- **Slack workspaces open in Flow on the web.** After connecting a Slack team, choose it under Workspaces and servers to read its channels and DMs, follow threads, and send, edit, or delete messages as yourself. Older history loads at the pace Slack allows and says so; reactions, files, and search show why they are not available until the Slack app is granted those permissions, and anything Flow cannot show has an Open in Slack link.
