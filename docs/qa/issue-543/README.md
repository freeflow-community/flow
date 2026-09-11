# Issue #543 validation

Implementation base: Flow `main` at `d81af9a` (includes #539–#542).

## Automated evidence

- `pnpm -r build`: all workspace packages build.
- `pnpm --filter @flow/web test`: 513 tests pass, including separate Slack
  identities/credential namespaces and exclusion from Flow background sync.
- `pnpm --filter @flow/slack-connector test`: connector tests cover independent
  PKCE verifiers, one-use/expiring callbacks and handoffs, wrong teams, partial
  scopes, identity mismatches, user-only authorship, encrypted persistence,
  concurrent refresh, ambiguous refresh failure, revocation during refresh,
  deactivation/reauthorization, scoped signed events, and isolated disconnect.
- `acceptance-web.mjs`: headless Chrome renders the real connection components,
  completes two simulated OAuth popup exchanges, confirms identity before adding,
  checks distinct registry records, and disconnects one while preserving the
  other. It checks that users have no connector URL form. `web-two-teams.png`
  is the resulting screenshot, using fixture teams and a local Flow connection.

The browser fixture substitutes Slack/connector HTTP responses. It does not
claim a live Slack authorization or a signed-in Flow backend. Connector HTTP
behavior is independently tested in the Node suite. The Vite development HMR
socket can report local-network blocking in headless Chrome; the UI assertions
and page JavaScript error checks still pass.

To reproduce the browser test:

```sh
VITE_SLACK_CONNECTOR_ORIGIN=https://connector.test pnpm --filter @flow/web exec vite --host 127.0.0.1 --port 5179
PLAYWRIGHT_HOME=/path/to/playwright-install node docs/qa/issue-543/acceptance-web.mjs
```

## Live acceptance — in progress

On 2026-09-11, the operator configured a Slack app and completed authorization
for one live team in two separate browser profiles. Read-only `auth.test` verified
the exact user/team; the encrypted store contains one active rotating user grant
and two client sessions. The operator then disconnected the original client
and successfully ran **Check authorization** in the private window. A read-only
store check confirmed one active grant and exactly one remaining client session.
The live per-client disconnect isolation test passed. No live messages were sent.

The operator subsequently added a second live workspace in the same client.
Read-only `auth.test` verified both distinct Slack team/user identities. The store
contains two active grants for two immutable team IDs, each with `chat:write`,
a refresh token, and one active client session. The live two-workspace connection
test passed alongside the isolated Flow test server. Workspace names and tokens
are omitted from this report. Automatic refresh and revocation remain untested
against live Slack; user authorship of a sent message has not been tested.

Both profiles reported a false cancellation on their first attempt. A regression
test reproduces `popup.closed` becoming true after browser isolation; verifier-bound
polling now completes without an opener. The headless browser fixture exercises
a callback with `Cross-Origin-Opener-Policy: same-origin`. Live retest is pending.
Follow `docs/dev/SLACK_CONNECTOR.md` to provision the dedicated app/connector,
then run this matrix before declaring #543's live acceptance complete:

1. Sign in to one Flow server. Authorize Slack test team A through **Connect
   Slack**, inspect actual team/user IDs, and add the verified workspace.
2. Authorize test team B through the same app/connector. Verify A and B remain
   distinct, alongside Flow, and both `GET /v1/connection` calls succeed.
3. Close consent, deny consent, choose a wrong team during reauthorization,
   withhold optional permissions, and exercise a workspace requiring admin
   approval. Record exactly which errors Slack actually returns. A policy page
   that never redirects can only be reported as canceled/expired locally.
4. Authorize team A in another browser profile. Exercise a rotating token on
   both profiles concurrently; verify only one refresh consumes the token.
5. On explicit operator request, send a harmless test message to a designated
   test channel through `POST /v1/messages`. Check its exact author in Slack's
   official client. Never treat a mocked response as authorship proof.
6. Disconnect profile 1; profile 2's connector session must still work. Remove
   the connector grant explicitly via its API; all its connector sessions must
   stop working while the Slack app remains installed.
7. Reauthorize; revoke a user token, uninstall the app in a test team, and
   deactivate the test account. Verify distinct states and signed lifecycle
   deliveries. Confirm another team's connection is unaffected.
8. Review HTTPS proxy logging, data volume permissions, key custody, app
   distribution status and each team's app approval policy. Record actual app
   ID, hosting owner, event delivery evidence and approval outcomes without
   recording tokens, passwords, or message content.

Do not close the live acceptance items based only on these automated fixtures.
