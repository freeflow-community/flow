# Fix the flaky slack ts ordering test

- `[server]` `[qa]` The slack `ts` ordering test asserted strict order over
  full-range `rand_a`, which the codec never promised — it failed ~3-5% of runs.
  Split into the two properties that do hold: strictly increasing across
  milliseconds, weakly monotonic within one while `rand_a < 1000`.
- `[server]` `[qa]` Added a test pinning the documented fold (`rand_a % 1000`),
  so a later id deriving a smaller `ts` is now an assertion rather than a
  random red. Codec unchanged — derived `ts` is externally visible to bots.
