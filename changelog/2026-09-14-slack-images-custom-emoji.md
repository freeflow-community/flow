# Slack image previews and custom emoji

- [server] Slack connector requests `files:read` and `emoji:read`; serves Slack file bytes on Flow's `/v1/files/:id[/thumb]` paths (user token, `files.slack.com` only) and custom emoji on `/v1/workspaces/:team/emoji` + `/v1/files/emoji:<name>`.
- [server] A Slack image file carries `hasThumb` only when the grant has `files:read`; other files keep the Open in Slack card.
- [web] Slack images preview like Flow attachments; Slack custom emoji render in reactions and the picker.
- [macos] [ios] Slack images preview like Flow attachments. Custom emoji stay web-only (existing Parity line).
- [qa] slack-connector baseline tests for file and emoji routes.

## Feature

- **See images shared in Slack channels.** Pictures posted in a Slack channel now show as previews you can open, instead of a link to Slack. Reconnect Slack once to allow this.
- **Custom Slack emoji in reactions.** On the web, reactions that use your Slack workspace's own emoji show the image.
