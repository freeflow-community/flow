# File previews and downloads: fetch bytes from the presigned storage URL

- `[web]` `blobUrl('/v1/files/:id')` now asks for the file's storage URL first
  and fetches it bare, as images already did. Since #553 the authenticated
  fetch refuses redirects, and in production every file GET is a 302 to R2, so
  PDF/text previews, downloads, artifact files and custom emoji stayed on
  "Loading…" or did nothing. A backend that streams bytes itself is unchanged.
- `[desktop]` Content policy allows the PDF `<embed>` of an object URL.

## Feature

- **PDF previews, text previews and file downloads work again** in the web
  and desktop clients.
