# Re-domaining: flowtoo.org → freeflow.im

> **Status: Proposed** (2026-07-27). No code written yet. Requires operator
> action on Cloudflare, Railway, Google Cloud and npm that no agent can perform
> unattended — see §2 for what is gated on a human.

Move production from `app.flowtoo.org` to `app.freeflow.im`, and transactional
mail from `noreply@mail.flowtoo.org` to `noreply@mail.freeflow.im`, **without**
stranding installed native clients, breaking links already sitting in inboxes,
or losing the ability to auto-update Macs in the field.

The repo edits are trivial — 4 runtime files, 3 release scripts, 1 test, ~10
docs. The hard part is that three bindings to the old hostname are baked into
artifacts already distributed to users, and cannot be changed by deploying.
This spec is mostly about those.

## Scope

- **Infra:** new Cloudflare zone, Railway custom domain, R2 CORS origin, Google
  OAuth origin, Cloudflare Email Service sending domain. Both domains live
  simultaneously for an extended overlap. `[ops]`
- **Server:** `FLOW_EMAIL_FROM` / `FLOW_WEB_URL` defaults and the unfurl bot
  User-Agent. `[server]`
- **macOS/iOS:** a session-migration shim so existing installs survive the host
  change (§5), plus a bridging release that hands the Sparkle feed over (§6).
  `[macos]` `[ios]`
- **Bridge:** default `serverUrl` + a republish to npm. `[bridge]`
- **Docs:** `DEPLOYMENT.md` and the integrator guides.

Out of scope, deliberately: **changing the `org.flowtoo.*` bundle ids** (§4.3),
retiring `flowtoo.org` (§8 sets the policy; the actual teardown is a later,
separate decision), and any redesign of how `Server.storageSuffix` scopes
per-server state beyond the minimum needed to migrate.

---

## 1. Background — what actually binds us to the hostname

Grepping `flowtoo` finds 68 hits, but most are prose. The bindings that have
runtime consequences:

| Binding | Where | Baked into |
|---|---|---|
| Web/API origin | `FLOW_WEB_URL` env | server env — changeable by deploy |
| Email sender | `config.ts:34`, `FLOW_EMAIL_FROM` | server env — changeable by deploy |
| Emailed link bases | `services/auth.ts:154,216,259`, `services/workspaces.ts:390` | **messages already sent** |
| Mac server URL | `FlowServerURL` in Info.plist (`make-app.sh:15`) | **shipped .app bundles** |
| Mac update feed | `SUFeedURL` in Info.plist (`make-app.sh:31`) | **shipped .app bundles** |
| Native local state | `Server.storageSuffix` (`Server.swift:50`) | **on-disk state of every install** |
| iOS server URL | `project.yml:35` | **submitted builds** |
| Bridge server URL | `setup.ts:47` + each agent's on-disk config | **published npm tarball, user machines** |

The web client hardcodes nothing — it is served same-origin by the API server,
so it needs no changes at all.

`INVITE_URL_BASE` defaults to `flow://invite/` (a deep link, domain-free), but
`CHANGES_ARCHIVE_PHASE1-11.log:729` shows it was once set to an `https://` base
in production. **Read the live Railway value before assuming.**

---

## 2. Operator-gated steps

Everything in this section needs credentials or a human at a console. Nothing
downstream works until these are done, so they are the critical path.

1. Cloudflare: create the `freeflow.im` zone; point the registrar's nameservers
   at it.
2. Railway: add `app.freeflow.im` to the `app` service; read back the CNAME
   target and the `_railway-verify` token.
3. Cloudflare DNS: `app` CNAME → the Railway target, **DNS only (grey cloud)**,
   plus the `_railway-verify.app` TXT record.
4. Cloudflare Email Service: onboard `mail.freeflow.im` (DKIM/SPF/DMARC).
5. Google Cloud → Credentials → the Web OAuth client: **add**
   `https://app.freeflow.im` to Authorized JavaScript origins (additive; keep
   the old one).
6. R2: **add** `https://app.freeflow.im` to the `flow-files` bucket CORS
   `AllowedOrigins` (additive; keep the old one).
7. npm: publish the bumped `flow-agent-bridge`.

**The CNAME and certificate alone are not sufficient.** Railway's edge returns
404 "Application not found" — with a valid cert — until the TXT record verifies
ownership (`DEPLOYMENT.md:193`). Budget for this; it has bitten us before.

Note the two conflicting CNAME targets recorded in `DEPLOYMENT.md` (`:11` says
`d0altnvc.up.railway.app`, `:190` says `8pu0ejce.up.railway.app`) — the docs
have drifted. Take the value from Railway at the time of the change, and fix
whichever line is stale.

---

## 3. Stage A — run both domains at once

The end state of this stage: `app.freeflow.im` and `app.flowtoo.org` both serve
the same Railway service, both are valid Google OAuth origins, both are allowed
R2 CORS origins. **Nothing has switched over.** No env vars changed, no clients
repointed, no code merged.

Verify by hitting `https://app.freeflow.im/healthz` → `{"ok":true}` and by
signing in on the new host in a browser (exercises Google origins and R2 CORS
on a real upload).

This stage is fully reversible: delete the domain and the DNS records.

---

## 4. The three one-way doors

### 4.1 Shipped Macs poll the old appcast forever

`SUFeedURL` is stamped at build time (`make-app.sh:31`) from `FLOW_SERVER_URL`.
Every 2.x install in the field asks `app.flowtoo.org/download/mac/appcast.xml`
for the rest of its life. **A build cannot be told to look elsewhere except by
an update it receives from the feed it already trusts.**

Consequence: if `flowtoo.org` stops answering before an install has taken a
feed-switching update, that install can never auto-update again. Recovery is a
manual re-download, which requires knowing there's something to re-download.

The handoff is §6.

### 4.2 The host is the key to all native local state

`Server.storageSuffix` (`Server.swift:50`) derives from `baseURL.host` and is
appended to the Keychain slot, the GRDB cache path and every UserDefaults key,
so that dev and prod sessions never bleed into each other. It is shared by both
native clients (iOS compiles `../macos/Sources/Flow/Support`, `project.yml:28`).

Change the host and the suffix goes `@app.flowtoo.org` → `@app.freeflow.im`,
which addresses a *different, empty* namespace. Every existing install then
presents as a fresh install: **signed out, empty cache, full re-sync.** No data
is destroyed — the old state is still on disk under the old suffix — but
nothing reads it any more.

Mitigation is §5.

### 4.3 Bundle ids are identifiers, not URLs — leave them

`org.flowtoo.ios`, `org.flowtoo.app` (`project.yml:3,60,85`) and
`FLOW_APNS_TOPIC` are reverse-DNS *names*. Nothing resolves them; nothing
breaks by them disagreeing with the web domain.

Changing the iOS bundle id creates a **new App Store record**: existing installs
cannot upgrade to it, reviews and rankings do not carry over, and the APNs
configuration is re-issued. That is a product decision with permanent cost, and
it has nothing to do with re-domaining.

**Ruling for this phase: bundle ids stay `org.flowtoo.*` permanently.** If we
ever want to change them, it is its own project with its own migration story.
Record this in `decision_log.md` so it doesn't get "tidied up" later.

---

## 5. Native session migration

**Goal:** an existing install pointed at the new host finds its old session and
cache instead of a blank slate.

**Approach:** a one-shot migration keyed on a known list of prior suffixes.

- Add `Server.legacyStorageSuffixes: [String]` — hardcoded
  `["@app.flowtoo.org"]`. Not derived; an explicit list of hosts we have
  previously shipped, appended to over time.
- At app start, before the Keychain is first read: if no item exists at the
  current suffix **and** one exists at a legacy suffix, copy the token, the
  `currentUserId` UserDefaults key (and any other suffixed keys), and rename the
  GRDB database file to the new suffixed path.
- Guard the whole thing behind a `didMigrateStorage<suffix>` UserDefaults flag
  so it runs once and never re-runs after a deliberate sign-out.
- **Leave the old state in place** rather than deleting it — a copy is
  rollback-safe, a move is not.

**Keychain caveat.** `SyncEngine.didSignIn` already passes `persistToken: false`
on the bootstrap path specifically to avoid re-triggering the Keychain ACL
prompt after a rebuild. Writing the migrated token is a `SecItemAdd` under a new
account name and may prompt on a signed build. Verify on a **notarized** build,
not a local one — local and Developer-ID builds have different ACL behaviour.

**Fallback if this proves messy:** ship without it and accept a forced re-login
for all native users. That is survivable (nothing is lost, and the sign-in link
still works) but it is a visible, support-generating event, and it hits every
Mac and iPhone on the same day. Decide before §7 merges, not after.

**Test matrix:**

| Start state | Expect |
|---|---|
| Signed in on old host, updated to new-host build | still signed in, cache intact, no re-sync |
| Signed out on old host, updated | still signed out, no spurious session |
| Fresh install, new host | normal first-run |
| Local dev build (`isDefaultLocal`, empty suffix) | untouched — no migration |
| Migration run twice | second run is a no-op |

---

## 6. The bridging macOS release

The one sequence that avoids §4.1. Order matters and cannot be compressed.

1. Merge §7. `make-app.sh` now defaults `FLOW_SERVER_URL` to
   `https://app.freeflow.im`, so a default build gets **both** a new
   `FlowServerURL` and a new `SUFeedURL`.
2. Build that release and **publish it to the OLD feed** —
   `FLOW_UPDATE_URL_PREFIX` / `publish-dmg.sh` targeting `flowtoo.org`. This is
   the only unusual step: the artifact points at the new domain, the feed that
   advertises it is the old one.
3. Installed 2.x Macs poll the old feed, see the update, install it, and from
   the next launch poll the **new** feed and talk to the **new** host — with
   their session carried over by §5.
4. Publish subsequent releases to the new feed only.

Both feeds must serve during the overlap. `/download/mac/:asset` reads from the
blob store under `downloads/mac/` (`routes/index.ts:49,151`) and both hostnames
front the same Railway service, so in practice one upload is reachable from
both — **verify this rather than assuming it**, since it is the linchpin of the
whole handoff.

**There is no way to force step 3.** Adoption is whatever it is. This is the
single strongest argument for the long overlap in §8.

---

## 7. Repo changes

Runtime:

- `packages/server/src/config.ts:34` — `FLOW_EMAIL_FROM` default →
  `noreply@mail.freeflow.im`
- `packages/server/src/services/unfurl/fetcher.ts:11` — bot UA →
  `+https://app.freeflow.im/bot`
- `packages/agent-bridge/src/setup.ts:47` — default `serverUrl`
- `apps/ios/project.yml:35` — `FlowServerURL`
- `apps/macos/Sources/Flow/Support/Server.swift` — add `legacyStorageSuffixes`
  and the migration (§5)

Release scripts:

- `apps/macos/tools/make-app.sh:15` — `SERVER_URL` default (feeds both
  `FlowServerURL` and `SUFeedURL`)
- `apps/macos/tools/dist.sh:159` — `DOWNLOAD_PREFIX`
- `apps/macos/tools/publish-dmg.sh:24` — `WEB_URL`

Tests: `packages/agent-bridge/test/mcp-init.test.ts:7,17`.

Docs: `docs/ops/DEPLOYMENT.md` (~12 refs incl. the architecture diagram and the
R2 CORS command), `docs/design/IOS.md`, `docs/design/PUSH_APNS.md`,
`docs/specs/phase14.md`, `docs/integrators/AGENT_MEMBERS.md`,
`docs/integrators/APPS.md`, `packages/agent-bridge/README.md`,
`skills/flow-agent-member/SKILL.md`, and the comment strings in
`Server.swift:60`, `Profile.swift:20,24`.

**Do not rewrite `CHANGELOG.md` or `CHANGES_ARCHIVE_PHASE1-11.log`.** They
record what was true when written; editing them makes the history wrong. Same
for `docs/specs/phase1–16` — this spec supersedes, it does not retro-edit.

---

## 8. Email cutover and the old-domain overlap

**Email is the one thing that should not move on merge day.** A brand-new
sending domain has no reputation: signup, reset and sign-in mail from
`mail.freeflow.im` will land in spam at a higher rate until it warms up. Because
`.im` is an uncommon ccTLD, some corporate filters may be more conservative with
it than with `.org` — treat that as a thing to *measure* during warm-up, not a
settled fact.

Sequence: onboard the domain (§2.4) → send low volume and watch deliverability →
only then flip `FLOW_EMAIL_FROM`. Flip `FLOW_WEB_URL` independently, whenever
Stage A is verified; that only affects links in *newly sent* mail.

**Overlap policy.** `app.flowtoo.org` must keep serving — not merely redirect —
for as long as either of these is true:

- Macs in the field have not taken the §6 bridging update (needs the real
  appcast + DMG bytes at the old host, not a 301).
- Agent configs on disk still carry `serverUrl: https://app.flowtoo.org` (§9).

For plain web traffic and links already in inboxes, a 301 to the new host is
correct and can start as soon as the cutover is done.

Recommended overlap: **a year, not a month.** The cost is one Railway custom
domain and a DNS record; the cost of getting it wrong is permanently bricked
auto-update on an unknown number of machines.

---

## 9. Agent bridge

Two independent staleness problems:

- The **published tarball** (`flow-agent-bridge@0.9.0`) has the old default
  compiled in. Bump and republish (§2.7). Existing installs keep the old default
  until upgraded.
- **Agents that already ran setup** have `serverUrl` written to their config
  file on disk. A republish does not touch them. They keep hitting
  `app.flowtoo.org` until someone re-runs setup — indefinitely, in practice.

So the bridge is a *second* reason the old host must keep answering the real API
(not a redirect — these are API clients, and a 301 on a POST is not something we
should rely on them following correctly).

No forced migration is proposed. Document the re-setup step in
`AGENT_MEMBERS.md` and let it happen naturally.

---

## 10. Rollback

Per stage, worst case:

| Stage | Rollback |
|---|---|
| A (both live) | delete the Railway domain + DNS records; nothing else touched |
| Email flip | set `FLOW_EMAIL_FROM` back; old sending domain untouched |
| `FLOW_WEB_URL` flip | set it back; only affects mail sent in between |
| §7 merge | revert the commit; redeploy |
| §6 bridging release | **not reversible** — installs that took it now point at the new host. Recovery is another release, published to the *new* feed. |

The §6 release is the point of no return. Everything before it is a config
change; nothing after it can be undone by editing config.

---

## 11. Verification

- `https://app.freeflow.im/healthz` → `{"ok":true}`; old host likewise.
- Browser sign-in on the new host, including **Continue with Google** (proves
  the OAuth origin) and a **file upload + download** (proves R2 CORS — this
  fails on web while working natively if the CORS origin was missed, which is a
  confusing failure to diagnose).
- Register a throwaway account: the emailed link points at the new host and
  resolves.
- A link generated *before* the flip still resolves (old host, or its 301).
- Mac: install a pre-cutover build, publish the §6 release to the old feed,
  confirm **Check for Updates…** offers it, installs it, and that the updated
  app (a) talks to the new host and (b) is **still signed in** (§5).
- Same-day iOS check on a device that was signed in before the switch.
- `flow-agent-bridge` from npm with no `--server` flag reaches the new host; an
  agent with an old on-disk config still works against the old host.
- `pnpm -r build` and `swift build` clean; `pnpm -r test` green.

---

## 12. Acceptance

- Both hostnames serve the app; the new one is canonical for new traffic and
  new mail.
- A Mac that was signed in before the change is, after the bridging update,
  pointed at the new host, **still signed in**, and polling the new appcast.
- No install has been left on a feed that will stop answering — or, where that
  risk remains, the overlap window in §8 is committed to in writing.
- Bundle ids are unchanged, and `decision_log.md` records why (§4.3).
- `DEPLOYMENT.md` describes the new topology, including the corrected CNAME
  target, and the overlap policy with its end date.
- CHANGELOG gets `[server]` `[macos]` `[ios]` `[bridge]` entries; FEATURES.md
  gets a user-facing line about the new address (this one *is* user-visible —
  people will notice the URL and the sender changing).
- `decision_log.md` records the overlap-window ruling and the §5
  migrate-vs-force-relogin call.

---

## 13. Open questions for the operator

1. **§5 or force re-login?** Building the migration is maybe half a day plus
   notarized-build testing. Forcing re-login is free but hits every native user
   at once. Which?
2. **Overlap end date.** A year is my recommendation; it needs a real date in
   `DEPLOYMENT.md` or it will never be revisited.
3. **Is `app.` still the right subdomain?** `freeflow.im` is short enough that
   the apex, or a shorter host, might read better — and now is the only cheap
   time to decide, since every cost in this spec is per-move, not per-name.
4. **Live `INVITE_URL_BASE` value?** (§1) — changes whether invite links are
   affected at all.
