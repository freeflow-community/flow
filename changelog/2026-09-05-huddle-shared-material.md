# Discuss shared files in an ongoing bot Huddle

- `[bridge]` Route caller text, attachments and DM artifacts into the active Huddle through the existing Claude/Codex runtime, with spoken updates and no duplicate chat response.
- `[bridge]` Add bounded PDF/image/DOCX/XLSX/text preparation, reconnect reconciliation, cancellation and temporary-file cleanup; bump bridge to 0.33.0.
- `[qa]` Cover real document readers, call context, runtime input, download limits and call routing; mark shell/process-group fixtures POSIX-only.

## Feature

- **Share a file without leaving the call.** Send a document, image or text in your bot Huddle's DM and ask about it aloud. The bot can use that material in the ongoing conversation and explain when a format or file exceeds its reading limits.
