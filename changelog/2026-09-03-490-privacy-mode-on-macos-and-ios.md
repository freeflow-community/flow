# Privacy mode on macOS and iOS (#490)

- `[macos]` `[ios]` Profile settings gain a Privacy section: your own email,
  read-only, above the "Privacy mode" toggle. Live-saved on the flip, and the
  roster is refreshed with it so the Directory reacts at once.
- `[macos]` `[ios]` The Directory leaves privacy-mode members out of the
  listing *and* the search, matching web. The roster query still returns them —
  mentions, DMs and channel membership read the same rows.
- `[macos]` `[ios]` `privacyMode` reaches the clients on `/v1/me` and on the
  roster and is cached (GRDB migration v24), so a flip made on any client shows
  up on the others after a refresh.
- `[macos]` `[ios]` A privacy-mode member's own address no longer disappears
  from their own profile sheet: the workspace-wide `user.updated` broadcast
  carries the redacted DTO, and the handler used to adopt the blank over the
  address `/v1/me` gave it. Closes the wrinkle #489's Parity line flagged.
- `[macos]` `[ios]` The Directory's empty state now reads "nothing matched" off
  the query rather than the row count — privacy mode can filter every visible
  member out of a roster that is not empty, and `No one matches “”.` is not a
  sentence. Web made the same correction in #489.
- `[qa]` `privacyMode` is `Bool?` in Swift: an older server omits the key, and
  so does a row cached before the column existed — both read as "not hiding".
  `DirectoryTests` now runs in the iOS unit target too, so the shared rule is
  checked by whichever platform builds first.

## Feature

- **Privacy mode on your Mac and your phone.** The switch web already had is
  now in profile settings on both, with your own email shown right above it.
  Turn it on anywhere and it takes effect everywhere: your address stops being
  visible to anyone else, and you drop out of the workspace Directory — while
  staying in every channel and DM you were in, still findable and @-mentionable
  by the people you work with.
