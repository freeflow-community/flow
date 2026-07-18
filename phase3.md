# Phase 3: Production Deployment (Railway), OAuth, Email

**Scope:** deploy the single-node stack to Railway; Google OAuth login; email infrastructure (verification, invites, password reset); production key management; workspace admin operations; operational hardening (rate limits, logging, backups, health checks). Feature work is minimal — this phase is about making what exists real.

**Deployment:** single node on Railway (API+gateway process, Postgres, NATS, object storage bucket).

---

## 1. Railway topology

```
Railway project "mychat"
├── service: app        # Node process (API + WS gateway), Dockerfile from /packages/server
├── service: nats       # official nats:2 image (core NATS; JetStream stays off until the scale trigger), private networking only
├── plugin:  postgres   # Railway Postgres (encrypted volume, automated backups)
└── bucket:  files      # Railway object storage (S3-compatible) for file blobs
```

- **Networking:** only `app` gets a public domain (Railway-provisioned TLS). Postgres and NATS are reachable via private networking only. WS and REST share the one public origin (`wss://` upgrade on the same Fastify server — no infra change needed).
- **File storage:** implement the S3 driver for the phase-2 storage interface (`put/get/delete` by key) against the Railway bucket; blobs remain client-opaque AES-GCM ciphertext, so the bucket provider never sees content. Local dev keeps the directory driver.
- **Config:** all secrets via Railway environment variables. `MYCHAT_ENV=production` switches: secure cookies/headers, plaintext `enc_scheme=0` refused, CORS locked to the app origin.
- **Migrations:** run Drizzle migrations as a release step (Railway pre-deploy command), not at boot.

## 2. Key management on Railway

No AWS/GCP KMS here. Pragmatic single-node scheme, same envelope model as phase 1:

- **Master key** (32 bytes, base64) lives in a Railway env secret `MYCHAT_MASTER_KEY`. It wraps **data keys**, which are stored (wrapped) in a new `data_keys` table (`key_id`, `wrapped_key`, `created_at`, `retired_at`). At boot the service unwraps the active data key into memory — exactly the phase-1 dev flow, with the sealed file replaced by the env secret.
- Rotation of the *data* key = insert new wrapped key, mark old retired; old rows still decrypt via their `enc_key_id`. Rotation of the *master* key = re-wrap all rows in `data_keys` (tiny table) with the new secret. Backfill re-encryption tooling remains phase 4.
- **Trade-off recorded:** Railway staff/console access to env vars is inside the threat model boundary — acceptable for this phase; moving the master key to a real KMS is a drop-in upgrade later since only the unwrap step changes.

## 3. Google OAuth login

```sql
CREATE TABLE identities (
  provider          text NOT NULL,           -- 'google'
  provider_user_id  text NOT NULL,
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, provider_user_id)
);
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;  -- oauth-only accounts
```

```
GET  /v1/auth/google           → 302 to Google (state + PKCE)
GET  /v1/auth/google/callback  → verify, upsert identity, issue session token
```

- **Account linking:** callback matches on verified Google email — if a `users` row with that email exists, link the identity to it; otherwise create the user (display name + avatar seeded from the Google profile, `email_verified_at` set immediately since Google verified it).
- **Clients:** web redirects through the flow directly; macOS uses `ASWebAuthenticationSession` with a `myapp://oauth` callback carrying the session token. Same opaque-token session model afterwards — OAuth only replaces the credential check.
- **Rule:** an account with an identity and no password simply has no password login; "set a password" goes through the password-reset flow.

## 4. Email infrastructure

One `email/` module in `/packages/server`: provider = **Resend** (SMTP fallback behind the same interface), plain-text-first templates, all sends queued through a `pending_emails` table drained by an in-process worker (retry with backoff, no lost sends on restart — mini-outbox, consistent with Postgres as truth). The provider contract is `send(to, subject, text[, html])` only; no Resend-specific features (templates, webhooks, analytics) may be used — any SMTP provider must be a config-only swap. Local dev and tests use a console/Mailpit driver; cloud email is production-only. (Email delivery is an explicitly granted cloud exception — decision log 2026-07-18.)

Flows, all sharing one `email_tokens` table (`token_hash`, `user_id`, `purpose`, `expires_at`, `used_at`):

- **Email verification:** `users.email_verified_at timestamptz` added. On password registration, send a verification link (`POST /v1/auth/verify {token}`). Unverified accounts can sign in but cannot create workspaces or send invites (soft gate, keeps onboarding friction low). OAuth accounts skip it.
- **Invite delivery:** phase-1 invites now also send an email with the invite link. The copy-link flow stays.
- **Password reset:** `POST /v1/auth/forgot {email}` (always 200, no enumeration) → emailed link → `POST /v1/auth/reset {token, newPassword}`; resets revoke all existing sessions for the user.

## 5. Workspace administration

Closes the remaining admin gaps (channel-level ops shipped in phase 2):

```
PATCH  /v1/workspaces/:id                    {name}                    # owner/admin
PATCH  /v1/workspaces/:id/members/:userId    {role}                    # owner only; can't demote last owner
DELETE /v1/workspaces/:id/members/:userId                              # owner/admin, or self = leave
DELETE /v1/invites/:id                                                 # revoke pending invite
```

- Removal cascades: sessions keep working but membership checks fail closed; the gateway drops the workspace subscription on the `member.left` meta event. A removed user's messages remain (authorship preserved, Slack behavior).
- "Last owner" invariants enforced in one service-layer guard (can't leave, be removed, or be demoted if you're the only owner).

## 6. Operational hardening

- **Rate limiting:** `@fastify/rate-limit` — tight buckets on auth endpoints (per-IP) and message/file/invite writes (per-user); WS frames get a simple token bucket per socket (typing spam).
- **Observability:** pino structured logs with request IDs (Railway log drain), `/healthz` (liveness: process up) and `/readyz` (Postgres + NATS reachable) wired to Railway health checks. No Sentry — outside the cloud-exception list; clients log locally, and crash reporting can be requested as an explicit exception post-launch if needed (decision log 2026-07-18).
- **Backups:** Railway Postgres automated backups on; restore drill documented in the repo (`ops/restore.md`) and performed once before launch. Bucket blobs are ciphertext — the `data_keys` table + master key secret are what make backups restorable, called out in the drill doc.
- **Security headers/CSP** on the web client, `wss`/`https` enforced, session cookie flags (web) — one Fastify plugin.

## 7. Phase 3 Cut Lines

**In:** Railway deployment (app + NATS + Postgres + bucket), S3 storage driver, env-secret master key + wrapped data-key table, Google OAuth (web + macOS), email verification, invite emails, password reset, workspace admin (rename, roles, remove/leave, revoke invites), rate limiting, logs/health checks, backup + restore drill.

**Out (explicitly):** any second node or horizontal scaling (scale-triggered — see phase 4 Appendix A), real KMS, key-rotation backfill tooling (phase 4), remote push notifications (APNs/web push — needs its own mini-phase after deployment settles), custom domains/SSO/SCIM, Slack API compatibility (phase 4).

**Build order:**
1. Dockerfile + Railway project (app, NATS, Postgres) with health checks; deploy phase-2 feature set as-is
2. S3 storage driver against the Railway bucket; migrate local blobs if any matter
3. `data_keys` table + env-secret master key; production config gate
4. Email module + outbox worker; verification, invite emails, password reset
5. Google OAuth (server flow, then web client, then macOS `ASWebAuthenticationSession`)
6. Workspace admin endpoints + last-owner guard
7. Rate limits, log drain, backup restore drill
