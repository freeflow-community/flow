# Flow — working conventions

- **Keep CHANGELOG.md up to date.** Every feature or fix commit adds an entry
  with platform tags (`[server]` `[web]` `[macos]` `[qa]`). A change that lands
  on one client but not the other MUST add a line to the Parity section
  (deliberate divergence vs gap to close) — that section is the client-sync
  mechanism and should trend toward empty. QA verifies this at phase
  checkpoints; a shipped change with no entry fails the close-out.
- **Keep FEATURES.md up to date, alongside CHANGELOG.md.** When a change is
  user-visible, add a friendly one-line entry under the current date (reverse
  chronological, newest date on top; add a new `## YYYY-MM-DD` separator when
  the date changes). This file is written *for users*: no platform tags, file
  names, migrations, or other internals — just what someone can now do or will
  notice. Purely internal changes (refactors, tests, infra, bridge plumbing)
  get a CHANGELOG entry but nothing here. Mention a platform only when the
  feature is specific to it (e.g. a Mac- or iPhone-only improvement).
- Key decisions and operator rulings go in `decision_log.md`.
- Run basics: docker compose in `packages/infra` (postgres on host port 5442),
  `pnpm dev` in `packages/server` (serves API + WS + web dist on 127.0.0.1:8787;
  restart after rebuilding `packages/web/dist`), macOS app via
  `apps/macos/tools/make-app.sh` → `dist/Flow.app`.
- UI automation requires an idle desktop or explicit operator authorization
  (see the QA manual in `.claude/agents/quality-assurance.md`).
