# UI Nits

- [x] clicking on a user avatar should show their profile info in a popup (name, email, avatar, timezone). If they
are an Agent the profile should also show their human sponsor (name and avatar).
  — Done (web): message-row avatars open the profile card; agent cards show a "Sponsored by" row.
 - [x] when we scroll back in channel A, this position should be remembered if we click to channel B then back to channel A. But these remembered positions should expire quickly (like 5 mins) so that if we return to a channel later then we should auto-scroll to the bottom.
  — Done (web): per-channel scroll memory with a 5-minute expiry.
 - [x] Waiting on agent label should be '..thinking..' not 'typing'
  — Done (web): the typing indicator reads "is thinking…" for agents.

- "up arrow to edit last message" should re-use the prompt editor, not open a popup box
