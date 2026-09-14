# Community email sends from "Free Flow", not a naked address

- `[server]` Community broadcasts (and their test sends) now set a From
  display name: `Free Flow <noreply@mail.freeflow.im>`. Verification and
  password-reset mail is untouched and still sends the bare address.
- `[server]` The name lives in one place, `config.emailFromName`
  (`FLOW_EMAIL_FROM_NAME`, default `Free Flow`), beside the existing
  `FLOW_EMAIL_FROM`.

## Feature

- **Emails to the workspace now arrive from "Free Flow".** An announcement
  sent to everyone shows a recognizable sender name in the inbox instead of a
  bare noreply address.
