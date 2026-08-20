# macOS: restores hold their position through layout drift

- `[macos]` Pin decisions freeze briefly after every landing or restore
  scroll: geometry noise in that window read as reader intent — phantom
  re-pins aborted the restore's drift-corrector (landing you below your
  spot) and phantom unpins corrupted the scroll memory at bottom landings.
- `[macos]` The restore's drift-corrector no longer stops on pin state and
  gained a longer final pass, so late-sizing content above the target can't
  strand the position.
