# iOS: scrolls name the row, and a jump into a thread survives to land

- `[ios]` Every `proxy.scrollTo` in the transcript and the thread screen now
  targets the row identity (`clientMsgId`) instead of `message.id`. Rows have
  carried `.id(message.clientMsgId)` since #312, so the old targets matched no
  row and silently scrolled nowhere (#332, the macOS #329 defect).
- `[ios]` Both `ForEach`s key on `clientMsgId` too, so an optimistic row
  reconciling with its server echo re-renders in place rather than reading as a
  delete + insert — the #328 stuck-spinner shape.
- `[ios]` A jump into a thread reply now survives the trip and holds its
  position. Four owners were quietly fighting it: the channel screen cleared
  the target as "not in this channel's history" (a thread reply never is), then
  handed it to the transcript anyway, and once the thread landed the
  keyboard-resize glue and the new-reply follow both scrolled back to the end.
  The first two guards mirror `ChannelView`; the third is macOS's
  `focusEngaged()` claim, which outlives the target and is released by your own
  reply.
- `[ios]` The thread's jump re-asserts itself across the settling window: the
  screen is pushed fresh, so its `LazyVStack` has laid out nothing when the
  scroll is issued and one attempt lands short. Same belt as the transcript's
  restore and the arrival settle.
- `[ios]` Ported the #334 arrival settle, so a message arriving while you sit at
  the bottom is kept in view when its row sizes late. Closes both Parity gaps.
- `[qa]` `ScrollRowIdentityTests` covers all four behaviours in the Simulator
  with screenshots; fixtures from `qa-seed-scroll332.mjs`.

## Feature

- **Jumping to a message works on iPhone.** Tap a pinned message — in a channel
  or in a thread — and the conversation now scrolls to it and flashes it,
  instead of sitting wherever it already was. Replies you send in a thread
  scroll into view too, and a message that arrives while you're reading at the
  bottom no longer lands just below the fold.
