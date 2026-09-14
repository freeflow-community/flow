# iOS: tap the channel header to search the channel (#570)

- `[ios]` Tapping the channel name opens a focused search field under the
  header; results list below it, tap one to jump to that message. Cancel or a
  second header tap closes it. "Search in Channel…" is also in the `⋯` menu —
  a bare tap gesture is unreachable by VoiceOver.
- `[ios]` Matching reuses the shared `ChatSearch` / `ChatSearchIndex` behind
  macOS's ⌘F and web's find bar, so a hit means the same thing on all three.
  No server call: it searches the channel's cached messages (thread replies
  included, once their thread has been opened), and offers to page in older
  history rather than implying a miss is an absence.
- `[qa]` `UITests/ChannelSearchTests` — one test per acceptance criterion,
  green on an iPhone 17 Pro and an SE; screenshots in `docs/qa/issue-570/`.

## Feature

- **On iPhone, tap a channel's name to search that conversation.** The
  keyboard comes straight up; type and matching messages appear underneath,
  with your words highlighted. Tap one to jump to it in the conversation, or
  Cancel to go back exactly where you were.
