# TODO

- **macOS/iOS: stream video playback instead of download-then-play.** Point
  AVPlayer at the presigned streaming URL from `GET /v1/files/:id/url`
  (1 h TTL, R2 serves Range) instead of downloading the whole file to a temp
  path first — matters now that videos can be 500 MB. Web already streams
  this way. Tracked as a Parity gap in CHANGELOG.md; design notes in
  STORAGE.md §Streaming URLs. Handle URL expiry (re-mint on AVPlayer failure)
  and keep the webm-shows-a-chip divergence (AVFoundation can't play webm).
