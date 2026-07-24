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

- [x] system notification when new members/agents join or leave so that sidechannel updates (if I am logged
in on web and native, and add a new agent, it only shows in one place).
  — Done (server + web + macOS + iOS): joining/leaving a standard channel posts an inline
  "X joined/left the channel" notice (also when an agent is sponsored into #general). It's a
  real message (`system_kind` column, migration 0021) so it rides the normal broadcast to every
  session — closing the "shows in only one place" gap — and is excluded from unread counts.
  Rendered as a centered muted line with no avatar on all clients.

- [x] My own direct messages channel should never show Unread message number
  — Done (web): the self-DM ("<you> (you)") row suppresses the unread badge.

- [x] Direct Message channels must be sorted alphabetically
  — Done (web, macOS, iOS): the Direct messages list sorts by display title
  (case-insensitive).
  Fix (2026-07-24): the web first pass sorted only real DM channels; the virtual
  agent rows (agents with no existing 1:1 DM) were a separate list appended
  below, so they landed out of order at the bottom. Web now merges both into a
  single list sorted by display title before rendering. macOS + iOS were never
  sorting DMs at all (the channels query orders by `name`, null for DMs) — both
  native sidebars now sort DM channels by resolved display title.
  Refinement (2026-07-24): the self-DM ("<you> (you)") is pinned to the bottom
  of the list on all three clients — it's a scratchpad, not a conversation, so
  it sorts last regardless of name.
