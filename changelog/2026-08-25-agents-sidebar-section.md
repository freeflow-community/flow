# Left nav: a dedicated Agents section

- `[web]` `[macos]` `[ios]` New **Agents** section between Channels and Direct
  messages, listing every workspace agent alphabetically. Collapsible; the
  state persists per device. Absent entirely in a workspace with no agents.
- `[web]` `[macos]` `[ios]` An agent's 1:1 DM moves onto its agent row — unread
  badges, presence and sub-channels come with it — so an agent is listed once
  and never twice. Group DMs and the self-DM stay under Direct messages.
- `[macos]` `[ios]` One `AgentSection.split` shared by both native clients,
  matching the web's `splitAgents`; unit tests on both sides.

## Feature

- **All your agents in one place.** The left nav now has an Agents section
  above your direct messages, listing every agent in the workspace — including
  ones you've never messaged. Click one to open the conversation; collapse the
  section if you'd rather not see it.
