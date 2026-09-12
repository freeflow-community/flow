# Slack connector: deployable on Railway

- [server] Connector honours `HOST` (default loopback) and `CONNECTOR_LOCK=none` for hosts that already guarantee one container per volume; `packages/slack-connector/railway.json` carries its build, start and healthcheck. Deployment recipe in `docs/dev/SLACK_CONNECTOR.md`.
