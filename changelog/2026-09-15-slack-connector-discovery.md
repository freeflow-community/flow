# Native apps find the Slack connector

- [server] `GET /v1/client-info` advertises `slackConnectorOrigin` (`SLACK_CONNECTOR_ORIGIN`, else `VITE_SLACK_CONNECTOR_ORIGIN`; https only, null when unset).
- [macos] Workspaces & servers uses the advertised connector when the build has no `FLOW_SLACK_CONNECTOR_ORIGIN`/Info.plist value — a shipped app said "Slack connection is not configured" even though the deployment offers one.
- [qa] server discovery contract test covers the new field.

## Feature

- **Connect Slack on macOS.** The macOS app now finds the Slack connector from the Flow server, so Connect Slack works in a released build instead of saying Slack is not configured.
