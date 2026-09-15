# Slack: inactive conversations fold away

- [server] Slack connector tracks each conversation's newest message (live events, loaded history, a background check that yields to readers and the rate budget) and returns it as `lastActivityAt`; changes stream as `channel.activity`.
- [web] [macos] [ios] In a Slack workspace, channels and DMs with no known message in 30 days are hidden unless unread or open, with "Show N inactive" per section. Flow workspaces are unchanged.
- [qa] slack-connector activity test; web `hiddenAsInactive` tests; macOS rule tests.

## Feature

- **A tidier Slack sidebar.** Like Slack, Flow now hides Slack channels and direct messages with no messages in the last 30 days. Use "Show inactive" at the bottom of a section to see them. Right after you connect, conversations appear as Flow learns which ones are active.
