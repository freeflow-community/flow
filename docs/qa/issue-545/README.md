# Issue #545 validation

Implementation base: Flow `main` at `2ca7609` (includes #543 and #544).

## Automated evidence

- `pnpm --filter @flow/slack-connector test`: 27 tests, including the new
  baseline suite (normalizer, read routes, shared rate budget, mutations and
  scope gating, Events API routing per grant with bounded replay, HTTP contract
  with `Retry-After`).
- `pnpm --filter @flow/web test`: 518 tests, including the contract helpers and
  the registry/switcher changes for Slack teams.
- `swift test` in `apps/macos`: the whole suite plus `SlackBackendTests`
  (decoding, capability wording, rate-limit and scope errors, event stream,
  registry identity rules). The same file is in the iOS unit-test target list.
- `acceptance-web.mjs`: headless Chrome against the **real connector code**
  (`fake-slack-connector.mjs` runs `packages/slack-connector` with a fake
  Slack behind it: live-shaped replies, the measured 15-message page cap, a
  `Retry-After` budget, `missing_scope` for reactions, one Events API message).
  It seeds the browser registry with the Slack team as the active connection
  and no Flow server at all, then checks: boot through `backend.me()`,
  channel/DM list, mrkdwn conversion, external attachment card, degraded
  block notice, the history-limited banner and the countdown after a 429
  (no retry storm), gated controls absent (create channel, new DM, channel
  menu, huddle, attach, schedule, agent invite) and reactions shown as
  unavailable, send with optimistic reconciliation (no duplicate), edit,
  delete, thread replies, and a routed live event. It also fails on any
  stray non-connector request from the Slack session.

Screenshots (fake upstream, real connector):

- `web-slack-channel.png` — a Slack team in the web client with the limit banner.
- `web-slack-rate-limited.png` — the countdown after Slack refused the next page.
- `web-slack-thread.png` — thread replies through the connector.
- `web-slack-live-event.png` — the Events API message that arrived through the stream.

To reproduce:

```sh
pnpm --filter @flow/web exec vite --host 127.0.0.1 --port 5180 &
node docs/qa/issue-545/fake-slack-connector.mjs --port 8791 --client http://127.0.0.1:5180 > /tmp/fake.log &
CONNECTOR="$(head -1 /tmp/fake.log)" WEB_ORIGIN=http://127.0.0.1:5180 PLAYWRIGHT_HOME=/path/to/playwright node docs/qa/issue-545/acceptance-web.mjs
```

## Not verified here

- **Live Slack.** The connector's read and mutation routes were written from
  the shapes measured in #544 and the live-shaped fakes from #543, but this
  round ran no live grant: the 544 rig (tunnel + connector) was down and the
  web client needs an HTTPS origin the connector allows. Run the 543 rig with
  `CONNECTOR_CLIENT_ORIGINS` including the web preview's tunnel origin and
  `VITE_SLACK_CONNECTOR_ORIGIN` set at build time, then repeat the manual
  steps above against `#testing` before promising the feature.
- **Live updates in production** need the Slack app subscribed to
  `message.channels`, `message.groups`, `message.im`, `message.mpim` (user
  events); the app manifest now lists them, the live app does not yet.
- **Native sign-in and views.** macOS and iOS have the backend, the registry
  record and tests, but no Connect Slack flow and the sync engine still
  speaks Flow paths — see the Parity ledger.
- Reactions, files, search and read marks stay unavailable until the app
  carries those scopes; the connector already serves them when a grant does.
