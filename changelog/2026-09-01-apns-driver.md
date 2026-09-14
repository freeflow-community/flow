# APNs 6/6: the real driver — provider tokens, one HTTP/2 session, the error table

- `[server]` `FLOW_PUSH_DRIVER=apns` now talks to Apple. `node:http2` to
  `api.push.apple.com` / `api.sandbox.push.apple.com`, one pooled session per
  host, multiplexed; `GOAWAY`, a transport error or a close evicts the session
  and the next send dials a new one. No new dependency.
- `[server]` Provider auth is an ES256 JWT signed with the `.p8`, cached 55
  minutes in module state — inside Apple's 20–60 minute window, and not re-signed
  per request, which is a documented way to get rate-limited.
- `[server]` The error table is the behaviour: `410`/`BadDeviceToken` disables
  the device row and never retries; `403 InvalidProviderToken` logs an operator
  alarm and burns **no** retries; `429`/`5xx` retry on the worker's existing
  backoff; a request we built wrong (`BadCollapseId`, `PayloadTooLarge`) is
  logged with the payload and dropped. `403 ExpiredProviderToken` is the one
  403 that isn't an alarm — it drops the cached JWT and retries.
- `[server]` The per-device `environment` column picks the host, so a TestFlight
  build (production APNs) and a development build (sandbox) are live at once;
  `FLOW_APNS_ENV` is only the fallback.
- `[server]` Selecting `apns` without `FLOW_APNS_KEY`/`_KEY_ID`/`_TEAM_ID` now
  throws at boot naming the missing variable, instead of falling back to the dev
  driver and silently writing production pushes to disk.
- `[server]` A pooled session is ref'd only while a request is in flight: idle,
  it must not hold the process open; busy, it must not let the process exit
  mid-push and drop the notification silently.
- `[server]` Split `push/types.ts` and `push/target.ts` out of `push/index.ts`
  so the driver can name a device without importing the factory that builds it;
  `push/index.ts` re-exports both, so no call site changed.
- `[qa]` 29 new tests: a real ES256 sign-and-verify round trip against a
  generated P-256 key, and the driver against a real h2c server standing in for
  Apple — every row of the error table, the sandbox/production host choice with
  the device column beating `FLOW_APNS_ENV`, session reuse across 8 concurrent
  sends, and a real `GOAWAY` reconnect.
- `[server]` `docs/ops/DEPLOYMENT.md` documents the five `FLOW_APNS_*` variables
  plus `FLOW_PUSH_DRIVER` and `FLOW_PUSH_BODY_PREVIEW`.
