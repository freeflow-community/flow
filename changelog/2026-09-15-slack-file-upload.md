# Slack file uploads

- [server] Slack connector uploads files (`files:write`): `POST /v1/files` sends bytes to Slack's upload URL; a send with `file_ids` completes them as one message with the text, found via `files.info` (Slack returns no ts). A share not yet visible is `send_unknown`; the retry only looks again.
- [web] [macos] [ios] Attach, paste and drop upload through the workspace's backend, so a Slack workspace never calls a Flow upload endpoint (was HTTP 404). Paste and drop now respect the `files` capability.
- [qa] slack-connector upload test; web `slackBackend.test.ts`; macOS `SlackBackendTests`.

## Feature

- **Share files in Slack channels.** Attach, paste or drag a file into a message in a Slack workspace, and it posts to Slack with your message. Reconnect Slack once to allow this.
