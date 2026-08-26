# macOS and web downscale and convert images on upload

- `[macos]` The composer's three upload paths (paperclip, paste, drag-and-drop)
  now share one funnel, and it runs the existing `ImagePrep`: longest edge
  capped at 1024px, HEIC re-encoded to JPEG. Measured 1710 KB → 167 KB.
- `[web]` New `lib/imagePrep.ts` does the same in `createImageBitmap` + canvas,
  called from `uploadFile` so the presign sees the final size. Measured
  1710 KB → 97 KB. HEIC still passes through in browsers that can't decode it.
- `[server]` HEIC deliberately stays out of `IMAGE_MIMES` — the prebuilt libvips
  reads the container but can't decode HEVC, so it would return the same null
  sidecar after pulling the whole photo into memory. Reasoning recorded in
  `files.ts`.

## Feature

- **Photos you attach no longer upload at full camera size.** Every client now
  shrinks a large image before it goes up, so attaching a photo is faster and
  costs a fraction of the data. Photos from an iPhone in HEIC format also show
  a proper preview instead of a plain file chip.
