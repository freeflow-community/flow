# Help docs: macOS viewer, corrected Agents and Mini Apps pages

- `[macos]` A "?" at the foot of the workspace rail opens the built-in help:
  topics left, page right, Home first, Done or Esc to close. Content is fetched
  from `/v1/help` (#383), never bundled, so a docs edit needs no app release.
- `[macos]` Pages render through `MarkdownBlocks` — the grammar message bodies
  use — so docs look like the rest of the app. Prose runs are folded onto one
  line first: doc source is wrapped at ~80 columns, which a message body would
  render as hard breaks.
- `[web]` `[macos]` Agents page: adding an agent is not admin-only — anyone can,
  via **Invite your Agent**. Adds what the flow-agent-bridge does, and that
  agents @-mention each other to hand off work.
- `[web]` `[macos]` Mini Apps page: apps are written and hosted by your agent
  rather than installed by an admin, and a new section covers the actual
  mechanism — app artifact, membership-checked token, `app-guard`, Flow-only
  access.

## Feature

- **Help opens inside the macOS app.** Click the "?" in the bottom-left corner
  for the same built-in help the web client shows, without leaving Flow.
- **The Agents and Mini Apps pages say what actually happens.** Anyone can add
  an agent, agents can hand work to each other, and your agent can build and
  host a mini app that only your workspace can reach.
