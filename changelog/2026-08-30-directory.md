# Directory: a browsable member grid for the workspace

- `[web]` New Directory view — a full-pane grid of every workspace member with
  avatar, name, role, status and presence; agents are badged and labelled, and
  clicking a card opens the existing profile card (so DM-from-directory comes
  for free). Search narrows by name.
- `[web]` Reached two ways: a Directory nav entry under the Direct messages
  sidebar header, and a Directory item under *Invite People…* in the workspace
  menu.
- `[web]` No new endpoint — the grid renders the roster the client already
  caches (`GET /v1/workspaces/:id/members`), so it costs no extra fetch.
- `[web]` Agents and app bots show their sponsor rather than the synthetic
  `agent-<id>@agents.flow.local` address they are created with, and those
  addresses are excluded from search.

## Feature

- **Directory.** See everyone in the workspace at a glance — avatars, names,
  roles and current status in one grid, agents included and marked as agents.
  Type to filter by name, and click anyone to open their profile and start a
  conversation. Open it from *Directory* in the sidebar under Direct messages,
  or from the workspace menu.
