# Apps: Slack-compatible API

Flow speaks enough of Slack's app surface (phase 4) that an existing Slack bot
can run against a Flow workspace, usually by changing its API base URL. This
documents what's implemented, how to connect a bot, and where compatibility
ends. Production base URL: `https://app.flowtoo.org`.

## Creating an app

Workspace **owner/admin** only; the management UI is web-only (Apps modal), or
use the REST API:

```
POST /v1/workspaces/:id/apps        { "name": "My Bot" }   → { app, botToken }
GET  /v1/workspaces/:id/apps                               → { apps: [...] }
PATCH /v1/apps/:id                  { eventUrl?, eventTypes? }
POST /v1/apps/:id/disable | /enable
```

- The `xoxb-…` **bot token is returned once** at creation and stored hashed —
  copy it immediately.
- The app's bot is a real workspace user (`isBot`, appears in member lists,
  can be DM'd, shows presence via API activity).
- Disabling an app kills token auth and event delivery without deleting
  history.

## Web API (bot-facing)

`POST /api/<method>` with the bot token as a bearer header — Slack envelope
in, Slack envelope out (`{ok: true, …}` / `{ok: false, error: "…"}`), Slack
`ts` message-id codec, and Slack-mrkdwn ↔ Flow-markdown conversion both ways.
Verified against the official `@slack/web-api` SDK:

```js
import { WebClient } from '@slack/web-api';
const web = new WebClient(process.env.FLOW_BOT_TOKEN, {
  slackApiUrl: 'https://app.flowtoo.org/api/',
});
await web.chat.postMessage({ channel, text: 'hello from the bot' });
```

Implemented methods (17):

| Family | Methods |
|---|---|
| auth | `auth.test` |
| chat | `chat.postMessage`, `chat.update`, `chat.delete` |
| conversations | `history`, `replies`, `info`, `list`, `members`, `join`, `open` |
| users | `users.info`, `users.list`, `users.conversations` |
| reactions | `reactions.add`, `reactions.remove` |
| files | `files.upload` |

Anything not listed returns Slack's `unknown_method` error. Threads work via
`thread_ts` on `chat.postMessage` / `conversations.replies` (Flow threads are
one level deep, same as its native model).

## Events API (Flow → your bot)

HTTP Events only (see gaps below — no Socket Mode). Configure via
`PATCH /v1/apps/:id` or the Apps UI:

- `eventUrl` — your bot's public endpoint. Setting it triggers Slack's
  `url_verification` challenge handshake; `AppDTO.eventUrlVerified` flips true
  once your endpoint echoes the challenge.
- `eventTypes` — subset of:
  `message.channels`, `message.groups`, `message.im`, `app_mention`,
  `reaction_added`, `reaction_removed`, `member_joined_channel`,
  `member_left_channel`, `channel_created`, `channel_archive`.

Delivery semantics:

- Standard Slack `event_callback` envelopes, signed with Slack's **v0 HMAC
  scheme** (`X-Slack-Signature: v0=…` over `v0:<timestamp>:<body>`,
  `X-Slack-Request-Timestamp`) — stock Slack signature middleware works
  unchanged.
- Backed by a Postgres outbox: retries with backoff on failure, and the app is
  **auto-disabled** after persistent delivery failure (re-enable via the API/UI
  after fixing your endpoint).
- The bot's own messages don't generate events back to it (loop guard).

## Socket Mode

Flow speaks Slack's Socket Mode, so a bot with **no public URL** (laptop,
codespace) can receive events. App creation returns an app-level token
(`xapp-…`, one-time like the others). Standard SDK usage works:

```js
import { SocketModeClient } from '@slack/socket-mode';
const sm = new SocketModeClient({
  appToken: process.env.FLOW_APP_TOKEN,
  clientOptions: { slackApiUrl: 'https://app.flowtoo.org/api/' },
});
sm.on('app_mention', async ({ event, ack }) => { await ack(); /* … */ });
await sm.start();
```

(Python: `SocketModeHandler(app, app_token, web_client=WebClient(token=app_token,
base_url="https://app.flowtoo.org/api/"))` — the custom `web_client` is what
routes `apps.connections.open` to Flow.)

Under the hood: `apps.connections.open` (app-token-authenticated) returns a
one-time-ticket `wss://…/api/socket-mode` URL; envelopes are Slack-shaped
(`events_api` + `envelope_id` acks). Delivery comes from the same outbox as
HTTP events — a live socket is preferred, verified `eventUrl` is the fallback,
and either alone is sufficient (no `eventUrl` needed for socket-only bots —
just set `eventTypes`). Offline socket-only apps drop events after the retry
window (Slack semantics) but are never auto-disabled.

### Troubleshooting `invalid_auth` from apps.connections.open

- **Wrong app token**: Flow app-level tokens are ~50 chars (`xapp-1-` + 43).
  A ~98-char `xapp-1-A0…` token is a real-Slack one left in your env.
- All three credentials are shown **once, at creation** — if the app-token is
  lost, disable the app and create a fresh one (hard-refresh the web app
  first; a stale cached bundle may not render the App-level token panel).
- Python `slack_sdk` and Node `@slack/socket-mode` send the token in different
  places (form param vs header); Flow accepts both — this error is about the
  token's value, not its transport.

## Compatibility gaps (deliberate, phase-4 scope)

- **No RTM API** (the legacy streaming API predating Socket Mode).
- **No BlockKit** — `blocks` are ignored; only mrkdwn `text` renders. No
  interactive components (buttons/modals/shortcuts), no `/slash` commands.
- **No OAuth install flow** — no `oauth.v2.access`; tokens are minted at app
  creation by a workspace admin. One workspace per app.
- **No granular scopes** — a bot token can use every implemented method; it
  sees only channels it's a member of (join public channels via
  `conversations.join`; invite it to private ones).

## Credentials

App creation returns `{ app, botToken, signingSecret }` — **both credentials
exactly once** (the token is stored hashed; the secret is never exposed by any
later read). The Apps modal shows both with copy buttons at creation time. If
either is lost, create a new app (rotation = create + disable old).

## Local testing recipe

`packages/server/scripts/qa-slackbot.mjs` and `slack-sdk-check.mjs` exercise
the surface end-to-end against a local server; phase-4 QA ran the official
SDK against every implemented method. For a quick manual check:

```sh
curl -s -X POST https://app.flowtoo.org/api/auth.test \
  -H "Authorization: Bearer xoxb-…" | jq
```
