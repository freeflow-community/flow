# R2 bucket CORS: admit the desktop app's origin

- `[ops]` The `flow-files` bucket CORS policy now lists `app://flow`, so
  desktop uploads (presigned PUT) no longer fail with "Failed to fetch".
  Applied to the live bucket 2026-09-20; the one-time bucket recipe in
  `docs/ops/DEPLOYMENT.md` includes it from now on.
