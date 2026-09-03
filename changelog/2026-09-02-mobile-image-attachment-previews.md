# Reliable mobile image attachment previews

- `[server]` `[web]` Serve access-checked thumbnail URLs directly to image elements, with the authenticated blob path retained for local and legacy storage.
- `[web]` Give image attachments stable responsive geometry, explicit load and failure states, and retry/download actions; remove the cyclic mobile media sizing rule.

## Feature

- **Image attachments stay visible on mobile.** Previews now load reliably in mobile browsers and show clear retry and download actions if an image cannot be displayed.
