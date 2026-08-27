# Mini apps 1/4 — app artifacts, per-artifact secret, token mint, rotation

- `[server]` A link artifact can be pinned as an *app* (`app: true` on
  `POST /v1/artifacts`, url-only): the row gets a 32-byte secret, encrypted at
  rest with the message-body envelope and returned once in the create response.
  `ArtifactDTO` gains `isApp`; no read path ever returns the secret.
- `[server]` `POST /v1/artifacts/:id/app-token` mints a 5-minute single-use
  HMAC identity token for a channel member (`docs/design/MINI_APPS.md`), so an
  app's guard can authenticate viewers offline.
- `[server]` `POST /v1/artifacts/:id/app-secret` rotates the secret (creator or
  workspace admin) — the revocation lever: outstanding tokens stop verifying.
- `[server]` Migration `0033_artifact_apps.sql`. No client-visible change yet;
  the bridge guard and the mint-before-open clients are the next steps.
