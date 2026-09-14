# macOS + iOS: confetti on a 🎉 reaction (#524)

- `[macos]` `[ios]` A 🎉 or 🎊 reaction throws a one-second confetti burst from
  the reaction pill, the same on both clients as on web — a reaction arriving
  over the WS fires it exactly like a local tap. Closes the #514 parity gap.
- `[macos]` `[ios]` Same count-went-up rule as `lib/confetti.ts`, now shared
  Swift (`Support/Confetti.swift`, compiled into both apps): a first sighting
  never bursts, so channel load, scrollback and a row remounting stay still,
  and a removal animates nothing. `accessibilityReduceMotion` turns it off.
- `[macos]` `[ios]` `TimelineView` over a `Canvas`, no new dependency: particle
  positions are a pure function of the burst's age, so a frame is a draw and
  never a mutation. 26 per burst, capped at 200 concurrent, and the overlay
  renders nothing at all when no burst is live.
- `[macos]` `[ios]` The watcher sits on the message row, not the reaction row —
  the reaction row doesn't exist until a message has a reaction, so anchoring
  there would make the *first* 🎉 on a message look like a first sighting.

## Feature

- **Celebrate a message and it celebrates back, on your Mac and your phone.**
  React with 🎉 or 🎊 and a quick burst of confetti flies out of the reaction —
  and everyone else with the channel open sees it too. It only fires when the
  reaction is added, so scrolling through old messages stays calm, and it turns
  itself off if your system asks for reduced motion.
