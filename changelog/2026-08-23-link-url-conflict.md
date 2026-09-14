# Re-pointing a link artifact onto an already-pinned url is a 409, not a 500

- `[server]` `PATCH /v1/artifacts/:id` with a url another link artifact in
  the channel already pins hit the unique index raw and answered 500. Now a
  clear 409 `link_exists` (pre-check, plus the index violation mapped for
  the race). Fixes #315.
