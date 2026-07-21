# TODO

- **macOS/iOS: agent pairing approval prompt.** Sponsors currently must
  approve agent registrations in the web app. Native clients need the
  `agent.pairing` WS event handled + a prompt (code, workspace picker,
  approve/deny via `/v1/agent-requests/:id/*`), and "sponsored by" in any
  agent roster UI (`WorkspaceMemberDTO.sponsorId`). Tracked as a Parity gap
  in CHANGELOG.md.

- **macOS/iOS: stream video playback instead of download-then-play.** Point
  AVPlayer at the presigned streaming URL from `GET /v1/files/:id/url`
  (1 h TTL, R2 serves Range) instead of downloading the whole file to a temp
  path first — matters now that videos can be 500 MB. Web already streams
  this way. Tracked as a Parity gap in CHANGELOG.md; design notes in
  docs/design/STORAGE.md §Streaming URLs. Handle URL expiry (re-mint on
  AVPlayer failure) and keep the webm-shows-a-chip divergence (AVFoundation
  can't play webm).

- **Emoji: add common missing Slack aliases** (e.g. `:thread:`) to the shared
  catalog. (From the retired ui_nits.md list.)
- **macOS: message context menu "stutters"** — blinks in/out while hovering,
  making it hard to select. (From the retired ui_nits.md list.)
