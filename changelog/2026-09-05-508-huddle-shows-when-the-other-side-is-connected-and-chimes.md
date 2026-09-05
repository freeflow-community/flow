# Huddle shows when the other side is connected, and chimes (#508, #509)

- `[web]` `[macos]` `[ios]` Huddle UI now says whether the other side is
  actually there: **Connecting…** while an accepted invite hasn't turned up in
  the room, **Connected** with a green dot once it has — in the huddle bar and
  per tile in the grid.
- `[web]` `[macos]` `[ios]` A short chime on the caller's client the moment the
  call comes up, once per call. Generated in Web Audio / AVAudioEngine like the
  existing ringtone, so there is no bundled asset and no licence to track.
- `[web]` `[macos]` `[ios]` The rule lives in one place per platform
  (`lib/huddleConnection.ts`, `Support/HuddleConnection.swift`, unit-tested on
  both): a peer counts as connected once it has published audio — except a
  person, who counts on arrival, because everyone joins muted and silence from
  a person is a choice rather than a broken voice path.

## Feature

- **A Huddle now tells you when the other side is really there.** Calling an
  agent shows "Connecting…" until its voice path is up, then a green
  "Connected" — so a quiet call is no longer indistinguishable from a broken
  one — and a soft chime plays the moment the call connects.
