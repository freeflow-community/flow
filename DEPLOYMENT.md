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
  │          it to ~45ms, the practical floor for sfo↔Oregon. Old project kept
  │          as a fallback snapshot — delete after a few days of green.
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
| `FLOW_FILE_DIR` | `/data/files` (on the persistent volume) |

## Operations

Everything below assumes the Railway CLI is logged in and the repo directory
is linked (`railway link --project flow`).

```sh
# deploy the current working tree (manual; no GitHub auto-deploy yet)
railway up --service app --detach -m "what changed"
railway deployment list --service app --json   # poll until SUCCESS

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
| Blobs | `packages/server/.files/` | Railway volume `/data/files` |
| Data key | `.keys/data.key.json` (auto-created) | `FLOW_DATA_KEY` env |
| Web URL in emails | `http://127.0.0.1:8787` | `https://app.flowtoo.org` |

The production DB starts empty — no QA fixtures. First registered user
bootstraps their own workspace.

## Known gaps / next steps

- **No GitHub auto-deploy** — deploys are `railway up` snapshots. Connect the
  `app` service to `scottpersinger/flow` to ship on push to `main`.
- ~~macOS app targets localhost~~ — done: packaged apps default to
  `https://app.flowtoo.org` (`FlowServerURL` in Info.plist via make-app.sh;
  `FLOW_SERVER_URL` env overrides; bare `swift run` still defaults local).
  Per-server storage isolation keeps prod/dev sessions and caches separate.
- **Blobs on volume, not R2** — the `BlobStore` seam in
  `packages/server/src/storage/` is ready for a Cloudflare R2 driver
  (S3-compatible; credentials already provisioned). That would make the app
  service stateless.
- **No monitoring/alerting**; Neon free tier keeps ~6 h of point-in-time
  history. Revisit backups before real data accumulates.
- Single app instance. Multi-node was scoped in phase 4 (NATS is already the
  event bus), but nothing forces it yet.
