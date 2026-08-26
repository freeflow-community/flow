# Thread panel: the spinner clears on screen, and the jump lands

Follow-up to #331 (#328, #329): driving both issues in the app turned up a
second cause for each, in the view layer.

- `[macos]` A delivered reply's row now re-renders when its optimistic copy is
  swapped for the server twin. Rows carry `.id(message.clientMsgId)` (#312) but
  `ForEach` still keyed elements on `message.id`, so the swap read as a delete +
  insert whose two views claimed one `.id()` — the leaving pending view won and
  the "sending" spinner stayed up over a message everyone else could see (#328).
  Keying the `ForEach` on `clientMsgId` too makes it one element with a changed
  value. iOS has the same shape and is not fixed here (#332).
- `[macos]` The thread panel uses the channel list's scoped bottom anchor
  (`MacBottomAnchor`) plus an explicit landing settle. Its bare
  `.defaultScrollAnchor(.bottom)` re-anchored on every content size change and
  dragged the jump-to-reply scroll back to the end — that, not the scroll
  target, is what broke jump-to-message in threads (#329).
