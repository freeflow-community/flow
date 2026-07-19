# Flow — working conventions

- **Keep CHANGELOG.md up to date.** Every feature or fix commit adds an entry
  with platform tags (`[server]` `[web]` `[macos]` `[qa]`). A change that lands
  on one client but not the other MUST add a line to the Parity section
  (deliberate divergence vs gap to close) — that section is the client-sync
  mechanism and should trend toward empty. QA verifies this at phase
  checkpoints; a shipped change with no entry fails the close-out.
- Key decisions and operator rulings go in `decision_log.md`.
- Run basics: docker compose in `packages/infra` (postgres on host port 5442),
  `pnpm dev` in `packages/server` (serves API + WS + web dist on 127.0.0.1:8787;
  restart after rebuilding `packages/web/dist`), macOS app via
  `apps/macos/tools/make-app.sh` → `dist/Flow.app`.
- UI automation requires an idle desktop or explicit operator authorization
  (see the QA manual in `.claude/agents/quality-assurance.md`).
