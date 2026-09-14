# Bridge: lock the narration message's mid-turn invariants

- `[bridge]` New `progress-invariants` tests assert two properties over the
  whole ledger of writes a turn makes: rollover never edits or deletes the
  message it just sealed, and a status-row edit never targets a narration id
  (or the reverse). Both are the shapes #528 accuses the reporter of.
- `[bridge]` A third check — narration only ever grows before `finish()` —
  covers the "text vanished mid-turn" report directly; the one legitimate
  shrink (dropping the tail block the reply repeats) is scoped out by design.
- `[bridge]` No behaviour change: #528 stays open, still unreproduced on macOS
  and web against a live bridge.
