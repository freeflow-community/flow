# Re-domaining: flowtoo.org → freeflow.im

> **Status: In progress** (2026-07-27). Operator ruling the same day: the app is
> in minimal use, so **backward compatibility is not a concern**. That collapses
> most of what makes a re-domaining hard — no bridging release, no session
> migration, no long overlap. An earlier draft of this spec assumed an installed
> base and specced all three; it was cut rather than kept as dead weight.

Move production from `app.flowtoo.org` to `app.freeflow.im`, and transactional
mail from `noreply@mail.flowtoo.org` to `noreply@mail.freeflow.im`.

## Scope

- **Infra:** new Cloudflare zone, Railway custom domain, R2 CORS origin, Google
  OAuth origin, Cloudflare Email Service sending domain. `[ops]`
- **Server:** `FLOW_EMAIL_FROM` / `FLOW_WEB_URL` and the unfurl bot User-Agent.
  `[server]`
- **Clients:** the server URL each build is stamped with; rebuild and
  re-download. `[macos]` `[ios]`
- **Bridge:** default `serverUrl` + a republish to npm. `[bridge]`
- **Docs:** `DEPLOYMENT.md` and the integrator guides.

Out of scope: **changing the `org.flowtoo.*` bundle ids** (§2).

---

## 1. What breaks, and why we don't care

Three bindings to the old hostname live in artifacts already distributed, where
no deploy can reach them. With an installed base each would need its own
migration; with none, each is a shrug.

| Binding | Consequence | Response |
|---|---|---|
| `SUFeedURL` stamped into shipped `.app` bundles (`make-app.sh:31`) | existing Macs poll the old appcast forever | re-download once |
| `Server.storageSuffix` keys Keychain slot, cache DB and UserDefaults off the host (`Server.swift:50`) | every native install presents as fresh: signed out, empty cache | sign in again |
| Agent `serverUrl` written to config on disk (`setup.ts`) | existing agents keep hitting the old host | re-run setup |

Nothing is destroyed in any of these — old native state stays on disk under the
old suffix, just unread.

**What does *not* collapse**, and still needs care:

- **Email deliverability.** A new sending domain has no reputation. Low volume
  helps but doesn't exempt us; `.im` is an uncommon ccTLD and some corporate
  filters may treat it more conservatively than `.org`. Verify a real send lands
  in an inbox before relying on it.
- **R2 CORS.** Miss the origin and web uploads/downloads break while native
  clients keep working — a confusing failure to diagnose.
- **Railway TXT verification.** The CNAME and certificate alone are not
  sufficient: Railway's edge returns 404 "Application not found", with a valid
  cert, until `_railway-verify.app` proves ownership (`DEPLOYMENT.md:193`).

---

## 2. Bundle ids stay `org.flowtoo.*`

`org.flowtoo.ios`, `org.flowtoo.app` (`project.yml:3,60,85`) and
`FLOW_APNS_TOPIC` are reverse-DNS *identifiers*. Nothing resolves them; nothing
breaks by them disagreeing with the web domain.

Changing the iOS bundle id creates a **new App Store record** — no upgrade path
from the existing one, reviews and rankings reset, APNs re-issued. Permanent
cost, unrelated to re-domaining.

**Ruling: they stay, permanently.** Recorded in `decision_log.md` so a later
tidy-up doesn't "fix" them. When editing docs, change *URL* references only and
leave every bundle-id reference alone — they look similar and are easy to
sweep up by accident.

---

## 3. Order of operations

Steps 1–4 are prerequisites; nothing after them works until `/healthz` answers
on the new host.

1. **Cloudflare zone** — add `freeflow.im`; point the registrar's nameservers at
   the Cloudflare NS records.
2. **Railway** — add `app.freeflow.im` to the `app` service (project
   `36e91a36-9fa2-4881-9988-d81e45c16d6e`). Read back the CNAME target and the
   `_railway-verify` token.
3. **Cloudflare DNS** — `CNAME app → <target>`, **DNS only (grey cloud)**, plus
   `TXT _railway-verify.app = railway-verify=<token>`.
4. **Verify** — `curl https://app.freeflow.im/healthz` → `{"ok":true}`.
5. **Email** — onboard `mail.freeflow.im` in Cloudflare Email Service
   (DKIM/SPF/DMARC). Send a real signup mail; confirm it reaches an inbox.
6. **Repo** — §4.
7. **Railway env** — `FLOW_WEB_URL=https://app.freeflow.im`,
   `FLOW_EMAIL_FROM=noreply@mail.freeflow.im`. Also check the live
   `INVITE_URL_BASE`: the repo default is the domain-free `flow://invite/`, but
   `CHANGES_ARCHIVE_PHASE1-11.log:729` shows it was once set to an HTTPS base.
8. **Google OAuth** — swap the Authorized JavaScript origin to
   `https://app.freeflow.im`; keep the localhost dev origins.
9. **R2 CORS** — swap the origin in the `flow-files` bucket policy (command in
   `DEPLOYMENT.md:57`).
10. **Deploy** — merging to `main` auto-builds and ships.
11. **Rebuild clients** — `make-app.sh` → `dist.sh` → `publish-dmg.sh` (new feed
    directly). Rebuild iOS. Expect to be signed out on both.
12. **Bridge** — republish `flow-agent-bridge` to npm; re-run setup for any
    agent already configured.
13. **Retire the old domain** — 301 `app.flowtoo.org` → the new host for a few
    weeks, then drop the Railway domain and the DNS records.

---

## 4. Repo changes

Runtime:

- `packages/server/src/config.ts` — `FLOW_EMAIL_FROM` default
- `packages/server/src/services/unfurl/fetcher.ts` — bot User-Agent
- `packages/agent-bridge/src/setup.ts` — default `serverUrl`
- `apps/ios/project.yml` — `FlowServerURL` (**not** the bundle ids)

Release scripts:

- `apps/macos/tools/make-app.sh` — `SERVER_URL` default (feeds both
  `FlowServerURL` and `SUFeedURL`)
- `apps/macos/tools/dist.sh` — `DOWNLOAD_PREFIX`
- `apps/macos/tools/publish-dmg.sh` — `WEB_URL`

Tests: `packages/agent-bridge/test/mcp-init.test.ts`.

Comments/docs: `Server.swift`, `Profile.swift`, `docs/ops/DEPLOYMENT.md`,
`docs/design/IOS.md`, `docs/design/PUSH_APNS.md`, `docs/specs/phase14.md`,
`docs/integrators/AGENT_MEMBERS.md`, `docs/integrators/APPS.md`,
`packages/agent-bridge/README.md`, `skills/flow-agent-member/SKILL.md`,
`apps/ios/README.md`.

`Server.swift` needs **no** migration code — only the comment string.

The web client needs no changes at all: it is served same-origin by the API
server and hardcodes nothing.

**Do not rewrite `CHANGELOG.md` or `CHANGES_ARCHIVE_PHASE1-11.log`**, or
`docs/specs/phase1–16`. They record what was true when written; editing them
makes the history wrong. This spec supersedes, it does not retro-edit.

---

## 5. Rollback

Everything up to step 10 is a config change and reverts cleanly: delete the
Railway domain and DNS records, set the env vars back, revert the commit.

After step 11, clients are stamped with the new host — recovery is another
build, not a config edit. Cheap here only because the install base is us.

---

## 6. Verification

- `https://app.freeflow.im/healthz` → `{"ok":true}`.
- Browser sign-in on the new host, including **Continue with Google** (proves
  the OAuth origin) and a **file upload + download** (proves R2 CORS).
- Register a throwaway account: the emailed link points at the new host,
  resolves, and landed in an inbox rather than spam.
- Mac + iOS rebuilds reach the new host, sign in, and sync.
- `flow-agent-bridge` from npm with no `--server` flag reaches the new host.
- `pnpm -r build` and `swift build` clean; `pnpm -r test` green.

---

## 7. Acceptance

- `app.freeflow.im` serves the app; mail sends from `mail.freeflow.im` and
  lands in inboxes.
- Both native clients and the bridge default to the new host.
- Bundle ids unchanged, with the ruling recorded in `decision_log.md` (§2).
- `DEPLOYMENT.md` describes the new topology, with the CNAME target corrected —
  the current doc contradicts itself (`:11` vs `:190`) and both may be stale.
- CHANGELOG gets `[server]` `[macos]` `[ios]` `[bridge]` entries; FEATURES.md
  gets a user-facing line (the address and the sender both visibly change).
