# Invite several people at once (#578)

- `[web]` `[macos]` The invite sheet takes a comma-separated list (spaces,
  semicolons and newlines separate too) and sends it as one batch call (#577),
  listing each address with its own result.
- `[web]` `[macos]` Only the addresses nothing reached stay in the box after a
  submit, so a retry never re-mails the people who already got theirs.
- `[macos]` The sheet no longer claims "No email is sent" — it has been emailing
  invites for some time; the copy predated the server.

## Feature

- **Invite your whole team in one go.** Paste a list of email addresses into the
  invite box, hit Send Invites, and see what happened to each one — emailed,
  already a member, or a typo you can fix without retyping the rest.
