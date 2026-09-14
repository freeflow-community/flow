# APNs device-token registry

- `[server]` New `device_tokens` table (migration `0040`) plus `POST /v1/me/devices`
  and `DELETE /v1/me/devices/:token`, both under `requireAuth`. First slice of
  APNs push (#245); nothing sends anything yet.
- `[server]` The token is unique globally, so a phone that changes hands rebinds
  to its new owner instead of pushing to both accounts.
- `[server]` Account deletion now drops the user's device tokens in
  `tombstoneUser` — the FK cascade never fires on that path, because the users
  row is kept for message authorship.
