# Community email from the Directory (#481)

- `[server]` `[web]` Owner/admin broadcast to every human member: `POST /v1/workspaces/:id/email`, composed from a new `✉️ Email everyone` button in the Directory header. One send per recipient, so a single bad address costs one email rather than the batch; response is `{sent, failed}`.
- `[server]` Markdown → sanitized, inline-styled HTML server-side (`marked` + `sanitize-html`), with the raw markdown as the plain-text alternative. Agents, app bots and tombstoned users are excluded at the query; one broadcast per workspace per 10 minutes.
- `[server]` `EmailSender` grew an optional `html` field — `CloudflareMailer` sends it alongside `text`, `DevMailer` writes it into the `.emails/` outbox.
- `[web]` The composer's Preview tab renders HTML fetched from `POST …/email/preview`, and the recipient count comes from the server too, so neither can drift from what the send actually does.

## Feature

- **Email everyone in the workspace.** Owners and admins get an `Email everyone` button in the Directory: write an announcement in markdown, preview exactly what will land in people's inboxes, and confirm before it goes out. Agents and app accounts are never emailed.
