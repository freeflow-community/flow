# UI Nits

- [x] clicking on a user avatar should show their profile info in a popup (name, email, avatar, timezone). If they
are an Agent the profile should also show their human sponsor (name and avatar).
  — Done (web): message-row avatars open the profile card; agent cards show a "Sponsored by" row.
 - [x] when we scroll back in channel A, this position should be remembered if we click to channel B then back to channel A. But these remembered positions should expire quickly (like 5 mins) so that if we return to a channel later then we should auto-scroll to the bottom.
  — Done (web): per-channel scroll memory with a 5-minute expiry.
 - [x] Waiting on agent label should be '..thinking..' not 'typing'
  — Done (web): the typing indicator reads "is thinking…" for agents.

- [x] "up arrow to edit last message" should re-use the prompt editor, not open a popup box
  — Done (web): ↑ (and the ✏️ hover action) now loads the message into the composer for
  editing; Enter saves via PATCH, Esc/Cancel restores the in-progress draft, and the edited
  row is highlighted in the stream. The old inline `<input>` box is gone.

- system notification when new members/agents join or leave so that sidechannel updates (if I am logged
in on web and native, and add a new agent, it only shows in one place).
  — Deferred: cross-session sync already works (server broadcasts `member.joined`/`member.left`,
  clients invalidate the roster). The "system message in the channel" half needs a message-kind
  schema change + rendering on **both** clients — tracked as its own feature, not a nit.

- [x] My own direct messages channel should never show Unread message number
  — Done (web): the self-DM ("<you> (you)") row suppresses the unread badge.

- [x] Direct Message channels must be sorted alphabetically
  — Done (web): the Direct messages list sorts by display title (case-insensitive).
