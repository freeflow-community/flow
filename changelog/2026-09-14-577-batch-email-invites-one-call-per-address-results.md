# Batch email invites: one call, per-address results (#577)

- `[server]` `POST /v1/workspaces/:id/invites` also accepts `{ emails: [...] }`
  and returns `{ results: [{ email, status, inviteUrl?, expiresAt? }] }` —
  `sent` / `resent` / `email_failed` / `already_member` / `invalid_email`.
- `[server]` Each address is processed independently, so a typo or an existing
  member no longer fails the whole batch. Addresses are de-duplicated
  case-insensitively.
- `[server]` Legacy `{ email }` calls (current macOS/iOS clients) keep the same
  `InviteDTO` and the same `already_member` conflict.
