# Slack statuses (live, settable) and workspace icons

- [server] Slack connector subscribes to `user_change` and streams `member.updated` to every grant on the team; `PATCH /v1/me` sets the Slack status via `users.profile.set` (new `users.profile:write` scope).
- [web] [macos] [ios] `member.updated` patches the cached member and the signed-in user, so statuses change without a reload; the status picker writes to Slack and is disabled without the scope (new `status` capability).
- [server] Connector reads the team icon via `team.info` (new `team:read` scope) and serves it as the workspace `avatarUrl` (`/v1/files/team-icon:<team>`).
- [web] [macos] [ios] Shared emoji table gains Slack's default status emoji (🤒 🗓️ 🍽️ 🚫 🏡 🚌).
- [qa] slack-connector status test; web `slackBackend.test.ts`; macOS `SlackBackendTests`.

## Feature

- **Slack statuses stay up to date.** When someone changes their status in Slack, Flow shows it within a few seconds.
- **Set your Slack status from Flow.** The status menu in a Slack workspace now changes your status in Slack. Reconnect Slack once to allow this.
- **Slack workspace icons.** Slack teams show their own icon in the workspace list instead of a plain letter.
