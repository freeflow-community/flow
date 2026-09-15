# Slack profile cards

- [server] Slack connector serves `GET /v1/users/:id` in Flow's user shape: `users.info` for a person (time zone, title, status, email), the remembered app row for a bot.
- [web] [macos] [ios] The profile card loads through the Slack connection (was HTTP 404); in a Slack workspace "Message" opens the existing DM and is hidden when there is none, and Invite to workspace is hidden. Web shows Slack avatar URLs directly.
- [qa] slack-connector profile test.

## Feature

- **Profiles in Slack workspaces.** Opening someone from the Directory in a Slack workspace shows their profile, including their title, status and local time, and Message takes you to your conversation with them.
