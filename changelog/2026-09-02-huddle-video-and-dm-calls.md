# Video in huddles, and huddles in DMs that ring

- `[server]` Widened the LiveKit token grant to CAMERA, SCREEN_SHARE and
  SCREEN_SHARE_AUDIO. It was pinned to MICROPHONE, and LiveKit refuses an
  ungranted source *silently* — a camera publish became a dead track, not an
  error.
- `[server]` Huddles are scoped to an entity, not a channel: DMs and group DMs
  are now eligible. Room name is still the entity id, so one live huddle per
  entity comes for free.
- `[server]` New `huddle_invites` + `huddle_invite_targets` (migration 0042):
  the DM ring's lifecycle — ringing → active → ended / declined / missed /
  cancelled — with per-callee state so a group DM's answers are independent.
  Rows outlive a restart; ring timers don't, so a boot sweep retires any
  invite left `ringing` by a dead process.
- `[server]` Reachable means a live socket, not in DND, not a muted DM, and not
  already in another *DM* huddle. A channel huddle doesn't make you busy —
  the ring still shows, and accepting drops you out of it.
- `[server]` A resolved call posts "Missed huddle" / "Call declined" /
  "Call ended · 4 min" into the DM through the normal DM-notification path.
  Huddle lines count toward a channel's unread; join/leave lines still don't.
- `[web]` `[macos]` `[ios]` Camera and screen share in every huddle. Camera
  capped at 360p, share at 720p/15fps, adaptive-stream and dynacast on.
- `[web]` `[macos]` `[ios]` The thin audio bar stays while everyone is
  audio-only and becomes a tile grid the moment any video starts — self-view,
  active-speaker ring, per-tile mic/camera badges, tap-to-focus, and a big
  screen-share tile with a people filmstrip. Collapses back when video stops.
- `[web]` `[macos]` `[ios]` In-app ring overlay with Accept/Decline and a
  looping ringtone, shown only while the app is open. Answering on one device
  dismisses the others with "Answered on another device".
- `[macos]` Screen share picks a window or a display; an empty source list is
  how ScreenCaptureKit reports missing Screen Recording permission, so that
  path offers Open Settings rather than failing silently.
- `[macos]` `[ios]` Backgrounding turns the camera off and returning turns it
  back on with a hint; the huddle keeps running on audio.
- `[ios]` Views any screen share; its own sharing is Flow's own content until a
  Broadcast Upload Extension lands.

## Feature

- **Huddles now do video.** Turn on your camera or share your screen in any
  huddle. The huddle stays a thin bar while everyone is on voice, and opens
  into a grid of faces the moment someone switches their camera on — with a
  big tile for whoever is sharing their screen.
- **You can start a huddle in a DM, and it rings.** Starting one in a 1:1 or
  group conversation rings everyone who has Flow open, with a card you can
  accept or decline. If nobody's around you're told right away rather than
  left listening to it ring.
- **The conversation remembers the call.** Every huddle in a DM leaves a line
  behind — "Missed huddle", "Call declined", or how long you talked — so a
  call you missed is still there when you get back.
