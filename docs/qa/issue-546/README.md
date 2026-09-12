# #546 — Slack provider step 4: reconciliation, honest notifications, native parity

What this folder proves, and what it does not.

## Automated evidence

| Suite | Command | Result (2026-09-12) |
| --- | --- | --- |
| Connector | `cd packages/slack-connector && npm test` | 30 pass: idempotent sends with reconciliation after an unknown outcome, malformed events dropped, native `flow://slack` sign-in with the 302 back to the app |
| Web | `cd packages/web && npx vitest run` | 527 pass (ts-ordered insertion, stream validation, capability wording) |
| macOS | `cd apps/macos && swift test` | 60 pass, incl. `SlackRuntimeTests`: the sync engine boots, lists, reads, sends (with `client_msg_id`), applies stream events and signs out through a fake connector only |
| iOS | `xcodebuild … test -only-testing:FlowUnitTests/SlackRuntimeTests …` on iPhone 16 simulator | 11 pass (runtime + backend + capability suites) |
| iOS build | `xcodegen generate && xcodebuild -scheme Flow … build` | BUILD SUCCEEDED, `FlowShare` target included |

## Web acceptance (real connector, fake Slack)

```sh
pnpm --filter @flow/web exec vite --host 127.0.0.1 --port 5180 &
node docs/qa/issue-546/fake-slack-connector.mjs &        # prints {credential,...}
PLAYWRIGHT_HOME=<playwright pkg dir> CONNECTOR='<that JSON>' node docs/qa/issue-546/acceptance-web.mjs
```

The fake keeps #545's shape and adds three failure knobs: the first
`chat.postMessage` is stored by Slack but answered with a 503 (unknown outcome);
two Events API messages are delivered out of order around a malformed
`message_changed`; posted messages get a real "now" `ts` so reconciliation can
match them.

Asserted, with screenshots:

- `web-slack-send-unknown.png` — the send shows "Failed to send. Retry"; after
  Retry there is exactly one "Reconcile me" row in Flow **and** exactly one in
  Slack's history read back through the connector. No second post.
- `web-slack-events-ordered.png` — both live events render, every row is in
  `ts` order, the malformed event never appears and the stream keeps going.
- `web-slack-retention-note.png` — with the transcript exhausted, "Older
  messages may exist in Slack beyond what Flow can read here. Open in Slack"
  sits under the header at the old end.

Result: `PASS` (2026-09-12).

## Not covered here

- **Live Slack.** Everything above runs against a fake Slack. The rate limits,
  scopes and event shapes the fake uses are the ones measured in #544.
- **Native screenshots.** The macOS and iOS clients are verified by unit tests
  and builds only. Connecting a native client end to end needs an HTTPS
  connector and a real Slack consent page; seeding a session by hand means
  writing a Keychain item the app then has to be granted access to, which
  prompts on a shared desktop. Left for the pilot run.
- **Push when Flow is closed.** Not built; the capability says so. Design in
  `docs/dev/SLACK_CONNECTOR.md`.
