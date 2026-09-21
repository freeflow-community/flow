# Slack: agent app replies and profile photos

- [server] Slack connector draws `markdown` blocks (what AI/agent apps post), and falls back to Slack's text whenever a block type is unknown or the blocks draw to nothing — agent replies were rendering as blank rows.
- [macos] [ios] Slack profile photos (public `slack-edge.com` URLs) load again; the Slack image path only accepted connector file paths since #601, so people showed initials. Fetched without the connector credential.
- [qa] slack-connector agent-reply test; `loadsSlackProfilePhotosWithoutTheCredential`.

## Feature

- **Replies from Slack AI apps show up.** Messages from assistant apps in Slack threads now appear in Flow instead of as empty space.
- **Slack profile photos on the Mac.** People in Slack workspaces show their photos again instead of initials.
