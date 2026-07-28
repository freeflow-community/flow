# Building and releasing Flow

Flow ships as four separate things on four different schedules. This page is the
index: what each one is, the single command that builds it, and the single
command that releases it. Details live in the linked docs — this file stays a
map, not a duplicate.

If you only want to run Flow locally, you want
[Local development](#local-development) below, or the quick start in
[README.md](README.md). If you want to run Flow on your own server, you want
[DEPLOYMENT.md](DEPLOYMENT.md).

| Artifact | Build | Release | Automatic? |
|---|---|---|---|
| Server + web client | `pnpm build` | `git push origin main` | **Yes** — Railway builds every push to `main` |
| macOS app | `apps/macos/tools/make-app.sh` | `apps/macos/tools/publish-dmg.sh --build` | No — run locally, needs signing credentials |
| iOS app | `xcodegen generate` + Xcode | — | No — no distribution pipeline yet |
| `flow-agent-bridge` (npm) | `pnpm --filter flow-agent-bridge build` | bump `version`, merge to `main` | **Yes** — GitHub Actions publishes |

Two of these release themselves when you merge, and two do not. **Merging to
`main` does not ship the macOS or iOS app.** That is the single most common
thing to get wrong.

---

## Local development

Prerequisites: Node 22+, pnpm 10, Docker, and — for the native clients —
macOS 14+ with Xcode 26.

```sh
cd packages/infra && docker compose up -d   # Postgres on host port 5442, NATS
pnpm install
pnpm build                                  # = pnpm -r build across every package

cd packages/server
pnpm migrate
pnpm dev                                    # http://127.0.0.1:8787
```

The server serves the API, the WebSocket gateway, **and** the built web client
from `packages/web/dist`. It reads that directory at boot, so after rebuilding
the web client you must restart the server to pick it up.

Working on the web client alone is faster with Vite's dev server:

```sh
cd packages/web && pnpm dev
```

The pnpm workspace is `packages/*` only — `apps/macos` and `apps/ios` are native
projects outside it, built by their own toolchains.

| Package | Build output |
|---|---|
| `@flow/shared` | `dist/` — types and Zod schemas both the server and web import. **Build this first;** a stale `dist` here surfaces as `SyntaxError: does not provide an export named …` when the server boots. |
| `@flow/server` | `dist/` — TypeScript plus a copy of `src/db/migrations/*.sql` |
| `@flow/web` | `dist/` — typechecked (`tsc --noEmit`) then bundled by Vite |
| `flow-agent-bridge` | `dist/` — the published npm package |

---

## Server + web client

**The web client has no release of its own — it ships inside the server
deploy.** `pnpm -r build` writes `packages/web/dist`, and the running server
serves it.

Production is Railway, connected to `freeflow-community/flow`, so pushing to `main`
builds and ships. The contract is in [`railway.json`](railway.json): Railpack,
build `pnpm -r build`, start `node packages/server/dist/index.js`, gated on
`/healthz`.

```sh
git push origin main
railway deployment list --service app --json   # poll until SUCCESS
curl https://app.freeflow.im/healthz           # → {"ok":true}
```

Database migrations are additive `.sql` files in
`packages/server/src/db/migrations/` and apply at boot — shipping a migration is
just deploying.

Runbooks, environment variables, logs, rollback: **[docs/ops/DEPLOYMENT.md](docs/ops/DEPLOYMENT.md)**.

---

## macOS app

### Build

```sh
cd apps/macos
swift run Flow              # run straight from source
tools/make-app.sh           # package dist/Flow.app (needed for flow:// links and notifications)
```

`FLOW_SERVER_URL` is **baked into the bundle** at build time:

```sh
FLOW_SERVER_URL=http://127.0.0.1:8787 tools/make-app.sh   # local-server build
```

Unset, it defaults to `https://app.freeflow.im`. Check that the variable is not
exported in your shell before cutting a release build — a value left over from a
QA session ships an app pointed at localhost.

Sessions and caches are namespaced per server and per `FLOW_PROFILE`, so builds
against different servers coexist on one Mac without interfering.

### Release

One command, from the repo root:

```sh
apps/macos/tools/publish-dmg.sh --build
```

That runs the whole chain — release build, sign, notarize, staple, DMG, signed
Sparkle appcast — and uploads the update archives, deltas, appcast and DMG to
R2. Do not run `dist.sh` and `publish-dmg.sh` as separate steps unless you have
a reason to; `--build` already defaults the signing identity and the notarytool
profile, and publishing a DMG without the appcast ships a build that no existing
install is ever offered.

Three things to know:

- **Bump `apps/macos/VERSION` first.** `CFBundleVersion` is the commit count so
  it always increases, and Sparkle will offer the update either way — but the
  release notes users see are keyed to the short version, and reusing it puts
  two identically-titled items in the feed.
- **Run it in a terminal you can see.** The appcast is signed with an EdDSA key
  in the login keychain, which can raise a GUI prompt (`-25320` if unanswered).
- **One-time credentials:** a Developer ID Application certificate, a
  `flow-notary` notarytool profile, `dmgbuild`, and R2 keys in the repo-root
  `.env`. Setup is in [docs/specs/phase14.md](docs/specs/phase14.md) §2.

`.github/workflows/dist-macos.yml` mirrors this in CI, but it is
`workflow_dispatch` only and **has never been run** — every release so far has
been cut locally. Treat it as untested.

Signing, notarization, the DMG install window, the Sparkle feed layout:
[docs/ops/DEPLOYMENT.md](docs/ops/DEPLOYMENT.md) §§ *macOS app download* and
*macOS auto-update*.

---

## iOS app

The Xcode project is generated, not committed:

```sh
cd apps/ios
xcodegen generate           # creates FlowiOS.xcodeproj
open FlowiOS.xcodeproj      # then ⌘R
```

Headless simulator build:

```sh
xcodebuild -project FlowiOS.xcodeproj -scheme Flow \
  -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -derivedDataPath .build CODE_SIGNING_ALLOWED=NO build
```

**There is no release pipeline.** No TestFlight lane, no App Store submission,
no CI. Getting the app onto a physical device today means running it from Xcode
with a signing team; on a free personal team the certificate expires after seven
days and the app stops launching until you reinstall.

Simulator, device install, signing, and server selection:
[docs/design/IOS.md](docs/design/IOS.md).

---

## flow-agent-bridge (npm)

**It publishes itself. Never run `npm publish` by hand.**

[`.github/workflows/publish-bridge.yml`](.github/workflows/publish-bridge.yml)
fires on any push to `main` touching `packages/agent-bridge/**` and publishes
via npm trusted publishing (OIDC — no tokens, no OTP), skipping if the version
in `package.json` is already on the registry.

So releasing is: **bump the version in the same PR as the change**, and merging
ships it.

```sh
gh run list --workflow publish-bridge.yml   # check a release
```

---

## Open gaps

- **iOS has no distribution path.** No TestFlight, no App Store record, no CI.
  Everything above stops at "runs on a device you own."
- **`dist-macos.yml` is unproven.** It exists and is wired for secrets, but has
  never executed, so the macOS release remains a local, single-machine
  operation.
- **No version tags.** The repo has no git tags; released builds are traceable
  only through `apps/macos/VERSION` plus the commit count baked in as
  `CFBundleVersion`.
