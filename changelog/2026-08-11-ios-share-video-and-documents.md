# iOS: share videos and documents through the share sheet

- `[ios]` The share extension accepts movies and files, not just images, text
  and links. Movie beats image in the precedence rule, so a video shared from
  Photos never posts as its preview frame.
- `[ios]` Everything stays file-based — `ImagePrep` runs for images only, and
  the presigned PUT streams from disk, so a gigabyte video never enters the
  extension's ~120 MB process.
- `[ios]` The sheet previews what is about to be posted: a video's first frame
  and running time, or a type icon, name and size for a document.
- `[server]` `[ios]` `GET /v1/config` publishes `maxFileBytes`. The extension
  reads it and refuses an over-size file up front with the size and the limit,
  instead of failing at presign.
- `[qa]` `ShareExtensionTests` covers video-from-Photos, PDF-from-Files and the
  over-size error; `qa-share-extension.sh` seeds all three fixtures.

## Feature

- **Share videos and documents to Flow from any app.** Pick Flow from the iOS
  share sheet for a video, a PDF, a Word document or a zip — the same way
  photos and links already work. The sheet shows what you are about to post,
  and says so plainly when a file is too big to upload.
