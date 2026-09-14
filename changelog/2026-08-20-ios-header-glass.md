# iOS: the channel header is a floating pill

- `[ios]` The channel header is now a rounded pill in the sidebar's purple
  gradient, floating over a transcript that runs to the top of the viewport. It
  carries the channel name, the topic, the drawer button and the ⋯ menu; the
  system navigation bar is hidden on that screen.
- `[ios]` The transcript fades out under the status bar, so nothing competes
  with the clock.
- `[ios]` The empty state and the Activity feed keep the system bar, with the
  iOS 26 Liquid Glass capsule behind its button hidden — near-white discs that
  read as a band against `MC.base`.
- `[ios]` The thread screen keeps the system bar. Replacing it costs the
  interactive edge-swipe pop, which `ThreadNavTests` catches.

## Feature

- **The top of a channel on iPhone is a floating purple header.** The channel
  name and topic sit in a pill that matches the channel list, and the
  conversation runs behind it to the top of the screen.
