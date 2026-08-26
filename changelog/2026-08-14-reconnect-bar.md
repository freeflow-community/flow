# Loading bar while chat reconnects or catches up

- `[web]` `[macos]` `[ios]` Thin indeterminate bar under the channel header
  while the socket is down *or* the post-connect backfill is still running —
  connected alone isn't caught up, which is why a launch feels slow.
- `[web]` `[macos]` `[ios]` Shown only after 250ms of syncing and held at least
  500ms, so a short reconnect draws nothing instead of flashing.

## Feature

- **You can see when chat is catching up.** A thin bar appears at the top of
  the conversation while Flow reconnects or fetches what it missed, and clears
  itself when you are up to date. Brief hiccups stay invisible.
