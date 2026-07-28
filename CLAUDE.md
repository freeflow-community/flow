# Flow — working conventions

- **Keep CHANGELOG.md up to date.** Every feature or fix commit adds an entry
  with platform tags (`[server]` `[web]` `[macos]` `[qa]`). A change that lands
  on one client but not the other MUST add a line to the Parity section
  (deliberate divergence vs gap to close) — that section is the client-sync
  mechanism and should trend toward empty. QA verifies this at phase
  checkpoints; a shipped change with no entry fails the close-out.
- **Keep CHANGELOG entries very succinct** — one or two lines per bullet:
  what changed, and the *why* only when it isn't obvious from the what. No
  narrating the investigation, no restating the diff, no listing every file
  touched. The commit message is where reasoning belongs; the changelog is a
  scannable ledger. If an entry needs more than three lines, that's a sign it
  belongs in the commit body or `decision_log.md` instead.
- **Keep FEATURES.md up to date, alongside CHANGELOG.md.** When a change is
  user-visible, add a friendly one-line entry under the current date (reverse
  chronological, newest date on top; add a new `## YYYY-MM-DD` separator when
  the date changes). This file is written *for users*: no platform tags, file
  names, migrations, or other internals — just what someone can now do or will
  notice. Purely internal changes (refactors, tests, infra, bridge plumbing)
  get a CHANGELOG entry but nothing here. Mention a platform only when the
  feature is specific to it (e.g. a Mac- or iPhone-only improvement).
- Key decisions and operator rulings go in `decision_log.md`.
- **`BUILD.md` is the release map** — what each artifact is built and shipped
  by, and which ones ship automatically. Two rules worth knowing without
  opening it: merging to `main` deploys the server + web client (Railway) but
  does **not** release the macOS or iOS app, and shipping macOS is one command,
  `apps/macos/tools/publish-dmg.sh --build` (never `dist.sh` + publish as
  separate steps, and bump `apps/macos/VERSION` first).
- **ALWAYS bump `apps/macos/VERSION` in any PR that modifies the macOS app**
  (`apps/macos/**`, including the shared Swift core iOS reuses). The bump rides
  the same PR so the next `publish-dmg.sh` run can't reuse a released version's
  number — release notes are keyed to the short version, and reusing one puts
  two identically-titled items in the Sparkle feed.
- **`flow-agent-bridge` publishes itself.** Never run `npm publish` by hand.
  `.github/workflows/publish-bridge.yml` fires on any push to `main` touching
  `packages/agent-bridge/**` and publishes via npm trusted publishing (OIDC —
  no tokens, no OTP), skipping if `package.json`'s version is already on the
  registry. So releasing is just: bump the version in the same PR as the
  change, and merging ships it. Check a release with
  `gh run list --workflow publish-bridge.yml`.
- Run basics: docker compose in `packages/infra` (postgres on host port 5442),
  `pnpm dev` in `packages/server` (serves API + WS + web dist on 127.0.0.1:8787;
  restart after rebuilding `packages/web/dist`), macOS app via
  `apps/macos/tools/make-app.sh` → `dist/Flow.app`.
- UI automation requires an idle desktop or explicit operator authorization
  (see the QA manual in `.claude/agents/quality-assurance.md`).
