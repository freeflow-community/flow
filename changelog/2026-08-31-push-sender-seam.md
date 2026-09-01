# APNs 2/6: PushSender seam and dev driver

- `[server]` `src/push/index.ts` — a `PushSender` interface with driver
  selection by config, mirroring the email and blob-store seams. `PushDevice`
  is structural (token / platform / environment / bundleId) so the registry's
  row type (#245) satisfies it whichever PR merges first.
- `[server]` `dev` driver (the default) logs each push and writes the payload
  to `.push/` as a file `xcrun simctl push` accepts as-is — the same artifact
  proves the payload builder and drives a simulator, so QA needs no Apple
  account. The `apns` driver is registered but throws pending #250.
- `[server]` Config: `FLOW_PUSH_DRIVER`, `FLOW_APNS_KEY`, `FLOW_APNS_KEY_ID`,
  `FLOW_APNS_TEAM_ID`, `FLOW_APNS_TOPIC`, `FLOW_APNS_ENV`, `FLOW_PUSH_OUTBOX`;
  documented in `DEPLOYMENT.md`. A device's own environment/bundleId wins over
  the global default.
- `[qa]` Unit tests for driver selection, topic/environment precedence and the
  artifact's exact key set; the artifact was also delivered to a booted
  simulator with `xcrun simctl push`.
