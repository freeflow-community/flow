# Channel Files: every file shared in a channel, in one list

- `[server]` `[web]` `[macos]` `[ios]` A **Files** entry at the top of the
  channel `⋯` menu lists every file shared in that channel — thumbnail or
  file-type block, name, size, uploader, date, and a download button per row —
  sorted by Newest / Oldest / Name / Size.
- `[server]` `GET /v1/channels/:id/files` with `sort`, `before`, `limit`.
  Membership-gated exactly like reading the messages, and attachments of
  deleted messages are excluded, so deleting a message takes its files out of
  the list too.
- `[server]` Paging is cursor-based, not offset-based: the cursor carries the
  sort key plus the `(messageId, fileId)` that identifies the last row, so a
  new upload mid-scroll can't shift rows past the reader and ties (same size,
  same message) can't drop or repeat one.
- `[web]` `[macos]` Files is a tab on the existing side panel, alongside Thread
  and the channel's artifacts — chat stays visible, and the tab is per-channel.
  A row opens the viewer chat already uses: image/video lightbox or the PDF
  reader, each with Download.
- `[ios]` The list pushes full-screen from the channel `⋯` menu; images open
  the existing viewer and everything else opens in QuickLook, which plays media
  and carries its own share action.
- `[macos]` The shared download button gained a second chrome for panel rows —
  the attachment cards' opaque pill was invisible on a white panel — and an
  accessibility label, which used to read out as "End".
- `[web]` `[macos]` `[ios]` Video rows show a duration badge, read from the
  presigned stream URL rather than by downloading the video.

## Feature

- **Find any file shared in a channel without scrolling back through it.**
  Pick **Files** from a channel's `⋯` menu to see everything shared there in
  one list — a preview thumbnail or file-type icon, who shared it and when, and
  how big it is. Sort by newest, oldest, name or size, download a file straight
  from its row, or tap it to open it in place. On web and macOS the list opens
  beside the conversation so you can keep reading; on iPhone it opens
  full-screen.
