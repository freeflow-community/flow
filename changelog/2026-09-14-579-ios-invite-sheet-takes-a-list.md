# iOS invite sheet takes a list (#579)

- `[ios]` The invite sheet takes a comma-separated list and sends it as one
  batch call (#577), listing each address with its own result — the same states
  and copy web and macOS got in #578.
- `[ios]` The sheet no longer claims "No email is sent": the server has been
  emailing invites for some time, and the phone was the last client saying
  otherwise. Only an address whose email failed still shows a link, with Copy
  and Share.
- `[macos]` `[ios]` Dropped the single-address `{ email }` invite call now that
  no client sends it.

## Feature

- **Invite your whole team from your phone.** Paste a list of email addresses
  into the invite sheet, tap Send Invites, and see what happened to each one —
  emailed, already a member, or a typo you can fix without retyping the rest.
