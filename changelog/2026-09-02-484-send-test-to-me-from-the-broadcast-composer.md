# Send test to me from the broadcast composer (#484)

- `[web]` `[server]` "Send test to me" on the broadcast composer's confirm
  step mails the current draft to the author alone, subject prefixed
  `[Test] `. Same renderer, footer and plain-text alternative as the real
  send, so what lands in the inbox is what the workspace would get.
- `[server]` New `POST /v1/workspaces/:id/email/test`, same owner/admin gate
  as send. Its own per-user 1/minute limit, deliberately separate from the
  10-minute broadcast window — checking a draft must never be the reason the
  real send is refused.

## Feature

- **Send yourself a test before emailing everyone.** The confirm step of the
  community email composer now has a "Send test to me" button: it mails the
  draft to your own address, subject marked `[Test]`, so you can see how it
  really renders in your mail client. Sending a test doesn't use up the real
  broadcast.
