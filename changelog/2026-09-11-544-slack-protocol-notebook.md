# Slack provider step 2: protocol notebook and feasibility matrix

- [qa] `docs/design/slack-protocol/README.md` is now the versioned Slack client protocol notebook (v2): boot, socket handshake, heartbeat/reconnect, every chat mutation with its socket echoes, public-API baseline check, capability × platform matrix.
- [qa] Sanitized per-step fixtures under `docs/design/slack-protocol/fixtures/2026-09-11/`, made by `tools/sanitize.mjs` from a raw capture that never enters the repo; `tools/capture-hook.js` records in-page.
- [server] Connector scope manifest gains `readConversations` and `readHistory` (nine read scopes) so a grant can be measured and later used by the adapter; app manifest matches.
- [qa] Measured on the live test app: `conversations.history` is 1 request/min with 15 objects per page (the non-Marketplace cohort), shared per app + team; so no public-API history experience is promised.
- [qa] Blocker recorded, not papered over: the internal protocol needs a first-party `xoxc` session on every platform.
