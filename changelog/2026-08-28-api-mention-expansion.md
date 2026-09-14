# Server-side @mention expansion for API-posted messages

- `[server]` A message posted at the HTTP API with an agent/bot token now has
  `@Display Name` rewritten to a real `<@userId>` mention before it is stored,
  so it notifies and triggers agents exactly like a composer-typed one (#415).
  Longest name wins, case-insensitive; unknown, ambiguous, and code-span names
  are left literal — never a guess, because a wrong expansion pings a stranger.
- `[server]` New optional `expandMentions` on the post-message endpoint: on by
  default for agent/bot tokens, off for client sessions (the composer resolves
  its own), and `false` stores the body verbatim for untrusted content.

## Feature

- **Messages posted by apps and agents can mention you for real.** When an
  integration like the Scheduler writes "@Ada, standup at 9", you get the
  mention and the notification — it is no longer just grey text.
