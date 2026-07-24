# Deployment

Flow runs in production at **https://app.flowtoo.org**. This documents what's
deployed where, how to operate it, and what's deliberately not done yet.
First deployed 2026-07-19.

## Architecture

```
Cloudflare DNS (flowtoo.org)
  app.flowtoo.org  CNAME → d0altnvc.up.railway.app   (DNS only / grey cloud)
        │
        ▼
Railway project "flow"  (36e91a36-9fa2-4881-9988-d81e45c16d6e)
  ├─ app   — Fastify server: REST API + WS gateway + web client (one origin)
  │           volume "app-volume" mounted at /data (encrypted file blobs)
  ├─ nats  — nats:2.10-alpine, private-network only (nats.railway.internal)
  │
  ├──────► Neon Postgres 17 — project "flow-usw" (winter-water-17964134,
  │          aws-us-west-2, direct endpoint ep-lingering-night-afa8f8k5 — not
  │          -pooler), messages AES-256-GCM-encrypted at rest.
  │          Migrated 2026-07-20 from "flow" (weathered-mountain-27798470,
  │          aws-us-east-2): the app runs in Railway sfo, and the cross-country
  │          DB cost ~90ms per query (~1s per message send); us-west-2 halves
  │          it to ~45ms, the practical floor for sfo↔Oregon. Old project
  │          deleted same day after verifying green (operator call).
  └──────► Cloudflare Email Service — transactional sends from
             noreply@mail.flowtoo.org (signup, reset, account notes)
```

- Railway fallback URL: https://app-production-556c.up.railway.app
- The web client is served by the API server (`packages/web/dist`), so API,
  WebSocket, and web are one origin — no CORS.
- Build/start config is versioned in `railway.json` (Railpack, `pnpm -r build`,
  `node packages/server/dist/index.js`, healthcheck `/healthz`).
- Migrations run automatically at server boot (`src/db/migrate.ts`).

## Environment variables (Railway `app` service)

Secrets live only in Railway service variables — never in the repo.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon connection string. Use the **direct** endpoint (`ep-…aws.neon.tech`), not the `-pooler` one — postgres.js uses prepared statements, which break on PgBouncer transaction pooling. Keep `sslmode=require`; drop `channel_binding`. |
| `NATS_URL` | `nats://nats.railway.internal:4222` (private network) |
| `HOST` | `::` (listen on all interfaces; Railway routes over IPv6) |
| `NODE_ENV` | `production` |
| `FLOW_DATA_KEY` | Base64 32-byte encryption key (generated with `openssl rand -base64 32`). **Production-only key, independent of local dev's `.keys/` file. Losing it makes all message/file ciphertext unreadable — treat like a root credential.** |
| `FLOW_EMAIL_DRIVER` | `cloudflare` (real sends; the dev-only `autoVerify` register bypass is inert) |
| `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_KEY` | Email Service REST API credentials |
| `FLOW_EMAIL_FROM` | `noreply@mail.flowtoo.org` |
| `FLOW_WEB_URL` | `https://app.flowtoo.org` — base URL baked into emailed signup/reset links |
| `FLOW_FILE_DIR` | `/data/files` (on the persistent volume) — only read by the local blob driver and the one-time R2 migration |
| `FLOW_BLOB_DRIVER` | `r2` — file/thumb/avatar blobs in Cloudflare R2, presigned direct upload/download. Unset/`local` = disk under `FLOW_FILE_DIR`. |
| `CLOUDFLARE_S3_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` |
| `CLOUDFLARE_ACCESS_KEY_ID` / `CLOUDFLARE_SECRET_ACCESS_KEY` | R2 S3-API token pair |
| `FLOW_R2_BUCKET` | Bucket name (default `flow-files`). **One-time bucket setup**: create the bucket, then set a CORS policy — browsers preflight the presigned PUTs and CORS-check the 302'd GETs, so without it web uploads/downloads fail while native clients work fine: `aws s3api put-bucket-cors --bucket flow-files --endpoint-url $CLOUDFLARE_S3_ENDPOINT --cors-configuration '{"CORSRules":[{"AllowedOrigins":["https://app.flowtoo.org","http://127.0.0.1:8787","http://localhost:8787","http://127.0.0.1:5173","http://localhost:5173"],"AllowedMethods":["GET","PUT","HEAD"],"AllowedHeaders":["content-type","range"],"ExposeHeaders":["content-length","content-type","content-range","etag"],"MaxAgeSeconds":3600}]}'` (propagates in ~1 min; the S3 endpoint's TLS itself provisions ~1 min after the first bucket exists) |
| `FLOW_MIGRATE_BLOBS` | Set to `1` for ONE deploy to run the volume→R2 decrypt-and-copy at boot (idempotent; watch logs for `blob migration to R2 finished`), then remove. |

## Operations

Everything below assumes the Railway CLI is logged in and the repo directory
is linked (`railway link --project flow`).

Deploys are automatic: the `app` service is connected to
`scottpersinger/flow`, so **pushing to `main` builds and ships** (Railpack →
`/healthz` gate). Watch it with `railway deployment list`. Use `railway up`
only to deploy an unpushed working tree (hotfix/experiment) — it snapshots the
local directory and bypasses git.

```sh
# normal path: just push — Railway builds the new HEAD on push to main
git push origin main
railway deployment list --service app --json   # poll until SUCCESS

# manual override: deploy the current working tree without pushing
railway up --service app --detach -m "what changed"

# logs / status
railway logs --service app --lines 200
curl https://app.flowtoo.org/healthz           # → {"ok":true}

# env vars
railway variable list --service app --json
railway variable set KEY=value --service app
```

Database access: `psql` with the `DATABASE_URL` from Railway variables, or the
Neon console/MCP (project `weathered-mountain-27798470`). Migrations are
additive `.sql` files in `packages/server/src/db/migrations/` — they apply at
boot, so shipping a migration is just deploying.

## macOS app download

The signed-out web page (and the "app not installed?" fallback on the signed-in
CTAs) link to `GET /download/mac`, which 302s to a short-lived presigned URL for
the DMG stored in R2 at key **`downloads/Flow.dmg`**. Publishing a new build is
one command, no code deploy:

```sh
# Build the notarized DMG and upload it to R2 in one shot.
apps/macos/tools/publish-dmg.sh --build

# Or, if you already ran dist.sh, just upload the current DMG:
apps/macos/tools/publish-dmg.sh
```

`publish-dmg.sh` reads the R2 creds from repo-root `.env` (the same
`CLOUDFLARE_*` vars the server uses), maps them onto the `AWS_*` names the AWS
CLI actually reads — the CLI ignores `CLOUDFLARE_*`, so a bare `aws s3 cp` picks
up whatever stray AWS key is in your shell and fails with *"access key has
length 20, should be 32"* — and opts out of the CLI v2 default checksums that R2
rejects. `--build` first runs `dist.sh` (needs the Developer ID cert +
`flow-notary` notarytool profile; one-time setup in docs/specs/phase14.md §2 —
plus `pip3 install --user --break-system-packages dmgbuild` for the styled
drag-to-Applications install window).

The DMG opens as a drag-to-install window (Flow → Applications, with an arrow).
That layout is built by `dmgbuild` from `tools/dmg-settings.py` and the
background in `Resources/dmg-background.png` (+`@2x`), regenerated from
`tools/make-dmg-bg.swift` if missing.

Overwriting the key ships the new build immediately — the route always presigns
the current object. Until the key exists the route returns `404 not_found`
(the page's download link just fails to fetch, no crash). The bucket's existing
CORS policy already covers this (same-origin redirect from app.flowtoo.org).

## DNS / domain

Two records in the Cloudflare `flowtoo.org` zone, both required:

| Type | Name | Value |
|---|---|---|
| CNAME | `app` | `8pu0ejce.up.railway.app` — **DNS only** (grey cloud) |
| TXT | `_railway-verify.app` | `railway-verify=<token from the domain's Railway settings>` |

Hard-won lesson: the CNAME + certificate are **not sufficient** — Railway's
edge refuses to route the hostname (404 "Application not found", even with a
valid cert) until domain ownership is verified via the TXT record. The token
is in the custom domain's status (dashboard, or GraphQL
`customDomain.status.verificationToken`). If the custom domain is ever deleted
and re-added, the CNAME target changes — re-check both records.

Railway issues and renews the TLS cert; the Cloudflare proxy must stay off
unless the zone's SSL mode is set to Full and you accept Railway's proxy
caveats. If a cert sticks in `VALIDATING_OWNERSHIP`, force it with the
`customDomainIssueCertificate` GraphQL mutation.

Email DNS (`mail.flowtoo.org` sending domain) was configured in Cloudflare's
Email Service onboarding, separately from this record.

## Production vs local

| | Local dev | Production |
|---|---|---|
| DB | docker Postgres :5442 | Neon (TLS) |
| Email | dev driver → `.emails/` outbox + console link | Cloudflare, real sends |
| `autoVerify` register bypass (QA scripts, macOS dev) | works | ignored by design |
| Blobs | `packages/server/.files/` (disk driver, server-proxied uploads) | Cloudflare R2 `flow-files` (presigned direct up/download; volume `/data/files` legacy) |
| Data key | `.keys/data.key.json` (auto-created) | `FLOW_DATA_KEY` env |
| Web URL in emails | `http://127.0.0.1:8787` | `https://app.flowtoo.org` |

The production DB starts empty — no QA fixtures. First registered user
bootstraps their own workspace.

## Known gaps / next steps

- ~~No GitHub auto-deploy~~ — done: the `app` service is connected to
  `scottpersinger/flow` and ships on push to `main`. `railway up` remains the
  manual working-tree override (see Operations).
- ~~macOS app targets localhost~~ — done: packaged apps default to
  `https://app.flowtoo.org` (`FlowServerURL` in Info.plist via make-app.sh;
  `FLOW_SERVER_URL` env overrides; bare `swift run` still defaults local).
  Per-server storage isolation keeps prod/dev sessions and caches separate.
- ~~Blobs on volume, not R2~~ — done: `FLOW_BLOB_DRIVER=r2` stores blobs in
  Cloudflare R2 with presigned direct upload/download (see decision_log
  2026-07-20). After a verified `FLOW_MIGRATE_BLOBS=1` run, the `/data`
  volume is only a rollback safety net and can be dropped.
- **No monitoring/alerting**; Neon free tier keeps ~6 h of point-in-time
  history. Revisit backups before real data accumulates.
- Single app instance. Multi-node was scoped in phase 4 (NATS is already the
  event bus), but nothing forces it yet.
