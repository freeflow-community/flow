# Confetti on a 🎉 reaction (#514)

- `[web]` Adding a 🎉 or 🎊 reaction throws a one-second confetti burst from
  the reaction pill, for everyone with the channel open — the reaction arriving
  over the WS fires it the same as a local click.
- `[web]` Fires on the addition only: first sighting of a message never bursts,
  so channel load, scrollback and switching back to a channel stay still, and
  removing a reaction animates nothing. `prefers-reduced-motion: reduce` turns
  it off entirely.
- `[web]` Hand-rolled on one click-through canvas (`lib/confetti.ts`), no new
  dependency: 26 particles per burst, capped at 200 concurrent so a pile-on
  stays smooth, and the overlay removes itself when the last particle dies.

## Feature

- **Celebrate a message and it celebrates back.** React with 🎉 or 🎊 and a
  quick burst of confetti flies out of the reaction — and everyone else with
  the channel open sees it too. It only fires when the reaction is added, so
  scrolling through old messages stays calm, and it turns itself off if your
  system asks for reduced motion.
