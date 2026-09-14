# Open agent reports as rendered artifacts

- `[bridge]` File report creation now posts an Open report card after saving the artifact. Failed delivery can be retried without creating a duplicate report.
- `[bridge]` Version 0.36.0.
- `[server]` Persist requester/thread context and creation operation IDs; authorize report lookup by artifact ID.
- `[web]` Report cards open the artifact viewer, which renders Markdown headings and tables with loading and retry states.
- `[macos]` Open report cards in the originating window and render Markdown documents in the artifact viewer.
- `[ios]` Open report cards in the existing artifact sheet and render Markdown documents there.

## Feature

- **Read reports directly in Flow.** Agent reports open as formatted documents with tables, and their conversation cards remain available after reloading.
