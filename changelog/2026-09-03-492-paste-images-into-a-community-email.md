# Paste images into a community email (#492)

- `[web]` Pasting an image into the Email everyone composer inserts it inline
  at the cursor with a placeholder while it uploads. Plain-text paste is
  untouched (no `preventDefault` unless the clipboard holds an image).
- `[server]` New `workspace_email_images` table + unauthenticated
  `GET /v1/email-images/:token`: a broadcast's `<img>` is fetched by a mail
  client with no session, so `/v1/files/:id` would render as a broken image in
  every inbox. Adoption also stops the orphan sweep reaping images out of mail
  already delivered.
- `[server]` The email renderer now drops an `<img>` whose src isn't absolute
  http(s) — a relative path in an inbox has nothing to resolve against.
- `[server]` `[web]` 5 MB per image, enforced server-side; the composer
  translates the error into copy someone holding a screenshot can act on.

## Feature

- **Paste pictures straight into a community email.** Copy a screenshot, press
  Cmd/Ctrl+V in the email body, and it appears in place while it uploads — no
  separate upload step. Add as many as you like, delete them like any other
  text, and Review & send shows the email exactly as recipients will get it.
