# iOS: a jump to a thread reply lands on it

- `[ios]` Jumping to a pinned thread reply landed at the newest reply instead.
  Two causes: `ChannelScreen` paged its transcript to the head looking for a
  target that lives in a thread, then cleared it before `ThreadScreen` could
  claim it; and one `scrollTo` into a `LazyVStack` is aimed at estimated row
  heights, so it came up short. The channel no longer clears a target while a
  thread is pushed, and both list views re-assert a jump across the settling
  window — a landed jump then owns the position, as it does on macOS.
- `[ios]` Every `scrollTo` names the row identity (`clientMsgId`), not the
  message id, through the shared `MessageRowKey` helper — `.id()` is the
  documented scroll target (macOS #331/#333).
- `[ios]` Both transcripts key their `ForEach` on `clientMsgId` as well as
  their rows, so an optimistic message reconciling with its echo re-renders in
  place instead of remounting (the #333 stuck-spinner shape). Row keying is
  unchanged, so #312's avatar fix stands.
- `[ios]` Ported #334's arrival settle: a message arriving while you sit at the
  end is scrolled to before its row has a height, so it landed below the fold.
- `[qa]` `ScrollToMessageTests` + `qa-seed-scroll332.mjs` cover the three
  behaviours in the simulator and produce the PR screenshots.

## Feature

- **On iPhone, jumping to a message now takes you to it.** Opening a pinned
  reply from a thread lands on that reply instead of the bottom of the thread,
  a reply you send scrolls into view, and a message that arrives while you're
  reading the newest ones no longer stops just below the fold.
