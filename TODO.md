# TODO

- **iOS: real push notifications (APNs).** The last iOS parity gap — a phone
  whose app isn't running hears nothing, because the WS socket is suspended in
  the background. Designed end-to-end in `docs/design/PUSH_APNS.md`: device
  registry, `PushSender` seam (dev driver + `node:http2` APNs), outbox +
  worker, payload built off the existing `suppressAlert` gate, and silent
  badge-sync pushes off `notification.read`. Phase 1 (registry, seam, dev
  driver, `simctl`-verified rendering + tap-routing) needs **no Apple
  account**; phase 2 blocks on the operator questions at the foot of that doc
  — chiefly whether the message body may ride in the payload, and who holds
  the APNs Auth Key.

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
