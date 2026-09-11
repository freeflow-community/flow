# Slack OAuth connector proof of concept

- [server] Add an independent encrypted Slack OAuth connector with PKCE, shared grants, isolated device sessions, rotation, and lifecycle events.
- [server] Send the client secret on token refresh; live Slack refuses a PKCE refresh without it.
- [web] Complete Slack OAuth even when browser isolation severs the sign-in popup, avoiding false cancellation.
- [web] Add verified Slack team connections alongside Flow servers; Slack chat remains a later milestone.
- [qa] Add callback, identity, encryption, refresh-race, revocation, and registry tests; live acceptance tracked in `docs/qa/issue-543`.

## Feature

On the web, you can authorize a Slack workspace through a configured connector and review the verified team and account before adding it. Slack conversations are not available in Flow yet.
