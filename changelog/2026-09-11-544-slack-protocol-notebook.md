# Slack provider step 2: protocol notebook and feasibility matrix

- [qa] `docs/design/slack-protocol/README.md` is now the versioned Slack client protocol notebook (v2): boot, socket handshake, heartbeat/reconnect, every chat mutation with its socket echoes, public-API baseline check, capability × platform matrix.
- [qa] Sanitized per-step fixtures under `docs/design/slack-protocol/fixtures/2026-09-11/`, made by `tools/sanitize.mjs` from a raw capture that never enters the repo; `tools/capture-hook.js` records in-page.
- [qa] Blockers recorded, not papered over: internal protocol needs a first-party `xoxc` session on every platform; history rate capacity and app classification stay unmeasured until the test app carries read scopes.
