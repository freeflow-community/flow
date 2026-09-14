# iOS: Invite to Channel; workspace joins announce in #general

- `[ios]` New "Invite to Channel…" sheet: lists workspace members not yet in the
  channel, one Add button each. Reached from the channel "⋯" menu and by
  long-pressing a channel row in the drawer (web + macOS parity; closes the
  "invite to channel" item in the Parity ledger).
- `[server]` Joining a workspace (emailed invite, join link, or domain
  self-register) now posts "X joined the channel" in #general — the auto-join
  was silent before, unlike Browse→Join and agent joins. Accepting an invite
  while already a member no longer re-broadcasts `member.joined`.
- `[qa]` `InviteToChannelTests` (iOS) — menu → sheet → Add, server-verified.
  `systemMessages.test.ts` covers invite accept and join-link redeem.

## Feature

- **Invite people to a channel on iOS.** Open a channel, tap the "⋯" menu and
  choose Invite to Channel… (or long-press the channel in the sidebar). Pick
  anyone from your workspace and tap Add. People who are already in the channel
  are not shown.
- **New workspace members are announced.** When someone joins your workspace
  through an invite or join link, #general now shows "Name joined the channel".
