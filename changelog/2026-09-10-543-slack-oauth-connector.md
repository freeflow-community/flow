# Slack OAuth connector proof of concept

- [server] Add an independent encrypted Slack OAuth connector with PKCE, shared grants, isolated device sessions, rotation, and lifecycle events.
- [web] Add verified Slack team connections alongside Flow servers; Slack chat remains a later milestone.
- [qa] Add callback, identity, encryption, refresh-race, revocation, and registry tests; live Slack acceptance awaits app setup.

## Feature

On the web, you can authorize a Slack workspace through a configured connector and review the verified team and account before adding it. Slack conversations are not available in Flow yet.
