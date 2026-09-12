# Slack OAuth connector PoC (#543)

Status: on 2026-09-11, live Slack verified two workspaces, per-client disconnect,
grant removal, concurrent token rotation and user authorship of a sent message.
Cancelled and denied consent were checked too, and a live app removal delivered
signed `app_uninstalled` and `tokens_revoked` events that hit only that
workspace, and reconnecting afterwards restored service without replaying the
old events. Wrong-team reauthorization, admin-approval workspaces and account
deactivation remain rollout gates; see the QA report for the full acceptance
matrix.

## What runs

`packages/slack-connector` is an independent Node service with no dependency on
Flow authentication or workspace membership. It uses Node's built-in SQLite and
crypto modules (Node >=22.13; CI uses Node 24). Run one process with a persistent
volume behind an HTTPS reverse proxy. It binds loopback port 8790; the proxy must
run on the same host/network namespace. This is not deployed automatically with
the Flow server. Do not run multiple replicas against the database.

The operator sets `VITE_SLACK_CONNECTOR_ORIGIN` to the HTTPS connector origin
when building the web client. Users click **Connect Slack** in Workspaces and
servers without entering an address or registering an app. The panel opens Slack consent, then shows the verified team/user before adding the workspace.
Two teams at the same connector use distinct immutable provider identities:
`["slack", enterpriseId-or-null, teamId, userId]`. Flow remains selected; chat is a
later milestone. Slack records do not enter Flow REST/WebSocket synchronization.
Native client handoffs, GovSlack, and org-wide grants are not enabled by this PoC.
An enterprise-associated individual workspace is accepted only when `auth.test`
confirms the exact team, user, and enterprise returned by OAuth.

## Configure the Slack app

These steps are performed once by the Flow operator, not by each user.

1. Create a development Slack app from
   `packages/slack-connector/slack-app-manifest.json`. Replace `CONNECTOR_HOST`
   with the dedicated connector hostname in both URLs.
2. Confirm **PKCE enabled** and **token rotation enabled** in OAuth & Permissions.
   Slack makes PKCE enablement a one-way app setting; use a dedicated test app.
3. Supply the app's client ID, client secret and signing secret through the host's secret store,
   plus `CONNECTOR_ORIGIN`, `CONNECTOR_CLIENT_ORIGINS` (comma-separated exact HTTPS
   origins), `CONNECTOR_DB`, and `CONNECTOR_KEY`. See `.env.example` in the package.
   Generate the encryption key from 32 cryptographically random bytes, base64
   encoded. Keep it separate from the database and backups. Sign-in is PKCE and
   sends no secret. Token refresh sends the client secret: Slack's PKCE guide
   says refresh needs none, but live Slack answers `bad_client_secret` without it.
4. Set `VITE_SLACK_CONNECTOR_ORIGIN=https://<connector>` in the web build
   environment, then rebuild/deploy the web client. Start `pnpm --filter @flow/slack-connector start` with those environment
   variables injected. The package does not load `.env` implicitly. Configure
   the HTTPS proxy to forward to loopback and disable access/body/header logging
   for OAuth, API and event endpoints. Never log query strings on the callback.
5. Let Slack verify `https://<connector>/slack/events`. The receiver validates
   Slack's timestamp and HMAC against the **raw** request body, including challenge
   requests. Subscribe to `tokens_revoked` and `app_uninstalled` as user events.
6. Install/authorize in the first test workspace, then enable app distribution
   before authorizing a second workspace outside the app's development team.
   Each workspace may require administrator app approval. An unapproved app can
   stop inside Slack without returning a callback; the client reports cancellation
   or timeout rather than inventing a denial reason it never received.

Use Slack's standard `oauth/v2/authorize` with `user_scope`, then
`oauth.v2.access`. This preserves the workspace installation and lifecycle event
model. It is not OpenID “Sign in with Slack,” and does not use the newer
`oauth.v2.user.access` flow. Two independent S256 challenges protect the Slack
leg and the connector-to-client handoff. The Slack verifier never leaves the
connector except in the token exchange POST. Slack OAuth codes arrive in Slack's
standard callback query; they are not access tokens. The connector never places
Slack tokens, connector credentials, or handoff codes in a URL. Callback HTML
clears the query. The web client polls the connector with its operation ID and
private verifier to redeem the expiring, one-use handoff. It does not depend on
`window.opener` or `popup.closed`, which browser isolation can sever during login.
The original origin-bound `postMessage` exchange remains available for clients
that retain their opener relationship.

## Executable scope manifest

`packages/slack-connector/src/manifest.js` drives both requested scopes and
capability gating. A test compares it with the app manifest.

| Enabled capability | Slack method | Token | Scope | Event subscription |
| --- | --- | --- | --- | --- |
| Verify identity | `auth.test` | User | None | None |
| Send explicit test message | `chat.postMessage` | User | `chat:write` | None |
| Grant lifecycle | None | User grant IDs | None | `tokens_revoked`, `app_uninstalled` |

Only `chat:write` is requested. Workspace display names come from the OAuth
response, and user names from `auth.test`; no directory/history scopes are
requested. Partial grants can connect for identity; sending requires the granted
scope. Send uses only the verified user token, never a bot token, username
impersonation, or the legacy `as_user` argument. The returned `message.user` must
be the user and the message must not be a `bot_message`; otherwise the operation
reports `authorship_mismatch` (HTTP 409; the message may already have been sent,
so do not blindly retry). Slack also stamps the app's `bot_id`, `app_id` and
`bot_profile` on user-token posts, so those fields do not mean a bot wrote it.
Verified live on 2026-09-11: the official Slack client showed the user as author.

## Connector API

All bodies/responses are JSON except the browser callback. Browser requests use
exact origin allowlisting; credentials use `Authorization: Bearer <connector
credential>`, never cookies. No endpoint accepts a Flow token as its identity.

| Endpoint | Purpose |
| --- | --- |
| `POST /v1/oauth/start` | `{challenge, clientOrigin, expectedTeamId?}` → Slack URL and operation ID |
| `GET /oauth/callback` | Slack-only browser return; consumes one-use state |
| `POST /v1/oauth/exchange` | `{handoff, verifier, operationId, clientOrigin}` → scoped credential + verified identity or distinct status |
| `POST /v1/oauth/poll` | `{verifier, operationId, clientOrigin}` → pending or one-use handoff redemption, independent of popup isolation |
| `GET /v1/connection` | Validate session/upstream grant and return identity, scopes, capabilities |
| `DELETE /v1/session` | Disconnect just this client |
| `DELETE /v1/grant` | Delete stored grant and all its connector sessions; does not uninstall/revoke a shared Slack app |
| `POST /v1/messages` | Explicit `{channel, text}` test send; no arbitrary methods, URLs, blocks, or author overrides |
| `POST /slack/events` | Signed lifecycle events from Slack |
| `GET /v1/events` | Grant-scoped lifecycle events, IDs for client deduplication; poll while the connection panel is open |
| `GET /health` | Process health only |

Do not execute a live message send without an explicit operator request. The web
PoC intentionally has no send button. Later chat phases must add their own scope,
method and event entries, conversation authorization, pacing and retention rules.
The sender shares Retry-After budgets by team/method across connector sessions;
this is not a production chat throughput implementation.

## Storage, refresh, and trust boundary

The connector operator can decrypt Slack credentials and observe content sent
through it. Make that operator/address explicit to users; self-hosting is supported.
This service is **not** a Slack archive. Every stored record is AES-256-GCM
encrypted with a random nonce and authenticated kind/ID. SQLite contains opaque
record keys; sessions are indexed by a SHA-256 hash of the connector credential.
The database, WAL, and key must have restricted filesystem access. Deleting a
record is logical deletion; volume/backups and key retirement are the operator's
responsibility. Existing data cannot be recovered with a different encryption key.

OAuth state lasts 10 minutes; handoffs 60 seconds; device credentials 30 days.
Periodic sweeping removes expired state, sessions and lifecycle replay records.
Lifecycle replay contains IDs/status only, retained at most five minutes and
bounded to 1,000 records. No conversation/message events are subscribed to or
stored. Events bind to app ID + team ID + revoked user ID, so another user/team
cannot read them. API authentication detects account deactivation even if Slack
sends no lifecycle event. No raw Slack response, message, token, or exception
text is logged or returned from the HTTP error handler.

Clients share one grant per immutable identity. Refreshes and reauthorization are
serialized per identity. Before refresh, the connector persists a fail-closed
marker, then saves the rotated access/refresh pair together. Concurrent clients
refresh once. A crash or ambiguous refresh response requires reauthorization;
the connector does not retry a possibly consumed refresh token. Signed revocation
or grant deletion during refresh cannot be overwritten by the refresh response.
New authorization updates the shared grant so surviving client sessions work
again. A client disconnect removes only its session. Removing the connector grant
forgets it locally; users who want to revoke upstream permissions must do so in
Slack's app management UI.

Startup takes an exclusive `<database>.lock` file. A graceful shutdown removes
it; after a crash the operator must verify no connector process owns the volume
before removing the stale lock and restarting. A multi-replica deployment needs
a shared transactional credential store and distributed refresh ownership before
it can replace this single-process PoC.

## Notifications: what exists, and the push design that does not (#546)

What ships: while a Flow client runs, the connector's `GET /v1/stream` delivers
message events, and the client itself posts a local banner for a mention or a
direct message (web: the `Notification` API; macOS and iOS: a local
`UNNotificationRequest` via `Banners.showLocal`). The `notifications` capability
therefore reads **limited** ("only while Flow is open"), never supported. No
client sends its APNs or Web Push token to the connector, and the connector
never sees a device token. Nothing reaches a closed app.

Why there is no push: Slack delivers events only to the connector. The Flow
server sends pushes only for its own notification rows, and there is no
server-to-server route by which the connector could ask it to. The
`device_tokens` table keys on the APNs token alone, so a second routed row for
the same device is also blocked by schema, not just by policy.

The smallest honest design, if a later phase wants it:

1. **A signed connector → Flow route.** The connector holds a per-deployment
   key. On a mention or DM event it POSTs `{routingId, title, body, target}` to
   a new Flow endpoint that verifies the signature and enqueues a push through
   the existing `pushOutbox`. The client registers its Flow routing id with the
   connector once per session (`POST /v1/push-route`), so the connector never
   holds a device token, only an opaque id the Flow server can resolve. Cost:
   the Flow server learns which Slack teams a device is subscribed to, and the
   connector learns which Flow server a device uses.
2. **Client-relayed** (no new server surface): a running client, on receiving
   a mention for a teammate's device, cannot help; this only works for the
   device's own foreground session and is what already ships. Listed to record
   that it was considered and does not close the gap.

Neither is built. Until one is, the wording in the capability reason is the
contract: alerts while Flow is open, nothing when it is closed.

## Distribution / hosting decision

The intended pilot is a dedicated app operated by the connector host, serving
explicitly approved test teams. HTTPS callback/event ingress, a persistent private
volume, key custody, and an outbound connection to `slack.com` are required.
Workspace admin policies can block installation or individual authorization.
Public distribution/Marketplace eligibility and real event delivery are **not
established by local tests**. Complete the live matrix in
`docs/qa/issue-543/README.md` before rollout. No history/replies scopes are enabled,
so this phase makes no claims about their non-Marketplace rate limits.

Primary references checked during implementation:
- [Slack OAuth flows](https://docs.slack.dev/authentication/installing-with-oauth/)
- [Slack PKCE](https://docs.slack.dev/authentication/using-pkce/)
- [Token rotation](https://docs.slack.dev/authentication/using-token-rotation/)
- [Token revocation events](https://docs.slack.dev/reference/events/tokens_revoked/)
- [App removal events](https://docs.slack.dev/reference/events/app_uninstalled/)
- [User message API](https://docs.slack.dev/reference/methods/chat.postMessage/)
