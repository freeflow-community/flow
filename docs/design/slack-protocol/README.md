# Slack client protocol notebook

Versioned record of what the official Slack web client actually does on the
wire, and a per-capability, per-platform feasibility matrix for the Flow Slack
provider (#544, spec `docs/specs/multi-server-workspaces.md`, sections
"Decode Slack's internal communications protocol" and "Public API baseline").

| Version | Date | What |
| --- | --- | --- |
| v1 | 2026-09-09 | [First browser observation](2026-09-09-first-observation.md): one warm reload in DevTools, control frames, counts schema. Partial evidence. |
| v2 | 2026-09-11 | This document: scripted read-only and mutation runs in the designated test workspace, sanitized per-step fixtures under `fixtures/2026-09-11/`, reconnect and heartbeat-deadline tests, public-API baseline check, feasibility matrix. |

Everything here is observation, not a Slack contract. Slack can change any of
it without notice. Every claim carries a confidence level and points at a
fixture; anything not seen is listed under "Unresolved", not guessed.

## 1. Method, environment, evidence limits

**Environment.** Operator-designated test workspace (a small workspace with
three human members and one app), channel `#testing`, the operator's own
member account. Ruling recorded in `decision_log.md` (2026-09-11). All
mutations were synthetic messages labelled "Flow protocol test" in `#testing`;
one was deleted as part of the test, the others remain.

- Client: Slack web client in Chrome 153 (macOS), build `_x_version_ts=1789166259`,
  `_x_frontend_build_type=current`, `_x_desktop_ia=4`, `_x_gantry=true`
  (values are sent on every request, see any fixture's `url.query`).
- Driver: the Claude-in-Chrome extension on the operator's signed-in tab.
- Capture: `tools/capture-hook.js`, injected into the page. It wraps
  `WebSocket.prototype.send`/`addEventListener`/`onmessage`, `fetch`, and
  `XMLHttpRequest`, records frames and API calls in page memory with tokens
  redacted at record time, and exposes step marks (`__flowCap.mark`).
- Export: session 1 was downloaded from the page as a raw JSON dump, kept in a
  scratch directory outside the repository, and run through
  `tools/sanitize.mjs` to produce `fixtures/2026-09-11/NN-<step>.json`. The
  sanitizer maps Slack IDs to stable placeholders (`U_1`, `C_7`, `T_1`, `F_1`,
  `Dr_1`), redacts human text and URLs, drops telemetry/pref bodies, and fails
  the run if a token or workspace hostname survives.
- Session 2 (cold reload, heartbeat test) could not be exported: after the
  reload Chrome blocked further script-initiated downloads and the extension's
  return path blocks/truncates long strings. `session2-boot-and-heartbeat.json`
  was re-typed from the in-page summaries and is labelled as such.

**Limits.**

- Session 1's hook was installed after page load, so the boot HTTP bodies
  (`client.init`, `client.channels`, `client.counts` first call) were not
  captured. Session 2's hook was installed ~30 ms after document load, before
  the socket opened, which caught the boot socket handshake and the boot HTTP
  call *order* (from the extension's own request log), but again not the
  bodies of the first-wave calls. The v1 notes cover `client.init` response keys.
- One account only: incoming typing, presence changes of a second live user,
  read marks caused by another user's message, and permission failures were
  not observed. Every HTTP call returned 200.
- `#testing` had four messages, so history pagination was not exercised.
- Browser cookies were not read. The `d`/`d-s` cookie names appear only as
  redaction rules, not as observations.
- Nothing was replayed by hand. No OAuth token was tried against an internal
  endpoint, and no internal token was extracted (spec hard rules).
- The extension cannot open `api.slack.com`, so the test app's distribution
  page was not read (see §6).

## 2. Authentication material per interface (spec area 1)

| Interface | Material observed | Origin / lifecycle | Confidence |
| --- | --- | --- | --- |
| Workspace HTTP API (`<workspace>.slack.com/api/*`) | POST form field `token` with an `xoxc-` prefix on every call, plus browser cookies (not inspected). Query string carries client build/session fields (`_x_id`, `_x_csid`, `slack_route`, `fp`, `_x_version_ts`, …). | Minted by the web session at boot; the page has it before `client.init`. Lifetime and renewal not observed. | High that it is required; nothing known about lifecycle. |
| Edge entity cache (`edgeapi.slack.com/cache/<team>/…`) | Same `xoxc-` token as a form field; `_x_app_name=client`. | Same session. | High. |
| Live socket (`wss://wss-<pool>.slack.com/?…`) | `token=xoxc-…` in the socket URL query, plus `start_args`, `flannel=3`, `lazy_channels=1`, `batch_presence_aware=1`, `sync_desync`, `gateway_server`, `no_query_on_subscribe`, `slack_client`. A fast reconnect adds `frt` (a short-lived reconnect token). The server also pushes `reconnect_url` frames carrying a fresh full URL. | Socket URL is built by the client; `reconnect_url` supplies replacements. | High. Fixtures `05`, `06`, `session2`. |
| Canvas collaboration service (`/canvas/collab/controller-init`) | A separate `oauth_token` + `oauth_token_expiry` in the response. | Issued per boot for the canvas editor. Redacted; not studied. | Medium. |
| File upload (`files.slack.com/upload/v1/<opaque>`) | Opaque signed path returned by `files.getUploadURL`; the PUT carries only the file. | One-shot per upload. | High. Fixture `23`. |
| Public Web API with the Flow connector (#543) | `xoxp-` user token, `xoxe-` refresh token, 12 h lifetime, refresh **requires** `client_secret` on live Slack (docs say otherwise). | OAuth v2 grant to the test app. | High (live, #543). |

**OAuth user grant vs first-party session.** Not tested by design (hard rule).
There is no observed evidence that an `xoxp-` token is accepted by
`client.*`, `edgeapi`, or the socket, and the socket URL's `start_args`
and `frt` come from session state the connector does not have. Conclusion
for the matrix: the internal protocol has a **first-party session
dependency** on every platform. A supported session flow does not exist yet;
designing one is a separate decision (see §7). Until then every "internal
protocol" row below is *observed* but *blocked* for Flow.

## 3. Bootstrap, discovery, socket negotiation (spec area 2)

Source: `session2-boot-and-heartbeat.json` (call order, socket handshake),
v1 notes (`client.init` keys), fixture `01` (channel open), `00` (counts poll).

**Boot HTTP order (cold reload).** First wave, no `slack_route`/`_x_csid` yet:
`experiments.getByUser`, `api.features`, `features.access.policies.list`,
`client.shouldReload`, `client.init`, `client.counts`, `conversations.view`,
`client.extras`, `client.channels`. Then, with `slack_route=<team>` and a
client session id `_x_csid`, roughly 40 more calls: `edgeapi` entity/permission
hydration (`permissions/info` ×5, `users/list` ×2, `users/info`, `users/counts`,
`huddles/info`, `huddles/list`, `channels/membership`), the visible channel's
`conversations.history` (twice: latest page, then an older page with `oldest`),
`conversations.replies` for an open thread, `subscriptions.thread.get`,
`messages.list`, `drafts.list`/`drafts.listActive`, `users.prefs.get` ×2,
`conversations.listPrefs`, `dnd.info`/`dnd.teamInfo`, and a long tail of
feature probes (workflows, calendars, canvases, help, surveys). Every call is
a POST with form encoding.

**Conversation discovery** is `client.channels` + `client.counts` (bodies not
captured this pass; v1 lists the counts keys). Opening a channel that is not
already hydrated fires, in parallel: `conversations.history`
(`limit=28`, `inclusive=true`, `ignore_replies=true`, `include_pin_count`,
`include_date_joined`, `include_stories`, `include_free_team_extra_messages`,
`no_user_profile=true`, `cached_latest_updates=<map>`), `conversations.listPrefs`,
`bookmarks.list`, `megaphone.notifications.list`, `edgeapi users/list`,
`users/counts`, `permissions/info` ×2, `channels/membership`, and a socket
`tickle` (fixture `01`). Switching to an already-hydrated channel made **no**
HTTP call (steps `02`–`04` produced nothing but a `pref_change` for the
sidebar section state; step `02` emitted no fixture at all).

**History response shape.** `{ok, latest_updates, unchanged_messages, messages,
has_more, pin_count, channel_actions_ts, channel_actions_count, date_joined}`
and, for an older page, `oldest`. `cached_latest_updates` in the request and
`unchanged_messages`/`latest_updates` in the response are a conditional-fetch
scheme: the client tells the server which message versions it holds, and the
server confirms unchanged ones instead of resending them. The same fields
appear on `conversations.replies` (fixture `14`) and `messages.list`
(fixture `22`). This is the closest thing to a gap-repair mechanism observed.

**Socket negotiation.** No separate HTTP negotiation call was seen; the client
constructs the socket URL from boot data. Frames are plain JSON text; no
compression or binary framing was observed on any of the six sockets.
Handshake (session 2, times from hook install): socket constructed at 32 ms,
`open` at 340 ms, `hello` at 416 ms, first client frame at 423 ms.

```
in  {"type":"hello","fast_reconnect":false,"region":"us-west-2","start":true,"host_id":…}
out {"type":"subscription_update","subtype":"user_change_subscribe_request","ids":[…],"id":N}
in  {"type":"reconnect_url","url":"wss://…?token=…&frt=…"}
in  {"ok":true,"reply_to":N,"type":"subscription_update","subtype":"user_change_subscribe_response","ids":[…]}
out {"type":"presence_sub","ids":[self],"id":N+1}
in  {"type":"presence_change","presence":"active","users":[self]}
```

`hello.start` was `true` on every socket, including fast reconnects; its
meaning is unresolved. Confidence: high for the sequence, low for semantics.

## 4. Event envelopes, heartbeat, acks, ordering, reconnect (spec area 3)

**Envelope.** Flat JSON object. Server events carry `type`, optional
`subtype`, `event_ts` (server-assigned, monotonic within the socket in every
fixture), and for message-ish events a `ts`. Client requests carry `type` and a
numeric `id` from a per-page counter (16399… in session 1); the matching reply
carries `reply_to` and, for `subscription_update`, `ok`. Only `ping`,
`subscription_update`, `presence_sub`, `user_typing`, and `tickle` were sent by
the client; only `ping` and `subscription_update` got a correlated reply.
`presence_sub`, `user_typing`, and `tickle` are fire-and-forget.

**Heartbeat.** Client sends `{"type":"ping","id":N}` every 10.0 s; `pong`
with `reply_to` arrives 20–30 ms later (`heartbeat.json`). Deadline test:
with outbound pings suppressed, the **client** closed the socket after
~96 s (close code 4998, no server close frame seen first), i.e. after ten
missed pongs, then opened a new socket 343 ms later and received
`hello` with `fast_reconnect: true`. Confidence: high for timing, medium for
"client-initiated" (inferred from the code range and absence of a server
close). Server-side idle timeout was not measured.

**Reconnect/resume.** Forced close from the page (fixtures `05`, `06`): new
socket open within 0.5–1.1 s, URL gains `frt`, `hello.fast_reconnect: true`,
the client re-sends its `subscription_update` and `presence_sub`, and makes
only two HTTP calls (`edgeapi users/info`, `sfdc.integration.listOrgs`).
**No** `conversations.history`, `client.counts`, or `messages.list` refetch
followed a fast reconnect. So the client either trusts the server to replay
nothing and relies on `client.counts` polling plus conditional history
fetches, or the resume state lives in `frt`/`start_args` and the server
withholds nothing. Which one is **unresolved**; nothing was sent during the
disconnect window in this pass (see §8, experiment 2).

**`reconnect_url`.** Pushed ~50 ms after `hello` and again periodically
(observed at +10 s and later at irregular intervals). Its `url` is a complete
socket URL with a new token and `frt`. Treat as opaque; do not log.

**Ordering and duplicates.** For every mutation the socket echo arrived
*before* the HTTP response of the call that caused it (send: echo at
+137 ms, HTTP 200 at +187 ms; thread reply: +147 ms vs +209 ms; delete:
+146 ms vs +171 ms; reaction: +448 ms vs +468 ms). A client must therefore
reconcile by `client_msg_id` (sends) or `ts` (edit/delete/reaction), not by
"HTTP first". No duplicate delivery was observed within a socket over 285
frames; the duplicates in the raw capture were a hook artefact and are
collapsed by the sanitizer.

**Polling still exists.** `client.counts` was called ~12 s after hook
install in session 1 and ~15 s after the heartbeat test started in session 2
(`_x_reason` values name a timeout-driven poll). A live socket does not stop
the client from reconciling counts over HTTP; the cadence was not measured.

**Gap detection/fill.** Not observed as a socket mechanism. There is no
sequence number, cursor, or "replay from" frame in any fixture. The observed
candidates are the conditional-fetch fields on history/replies/`messages.list`
and the counts poll. Unresolved (§7).

## 5. Message and thread shapes, mutations, files, read state, typing, presence (spec area 4)

All HTTP calls are POST form requests to `<workspace>.slack.com/api/<method>`
with the `_x_*` client fields plus `token`; only the interesting fields are
listed. Timings are HTTP round-trip / socket echo after the request started.

| Action | HTTP | Request fields (non-secret) | Response keys | Socket events (in order) | Fixture |
| --- | --- | --- | --- | --- | --- |
| Send message | `chat.postMessage` 187 ms | `channel`, `type=message`, `blocks` (rich_text), `client_msg_id` (uuid), `ts` = `<epoch>.xxxxx<n>` (provisional; server replaces it), `client_context_team_id`, `unfurl=[]`, `xArgs`, `include_channel_perm_error=true`, `_x_reason=webapp_message_send`, `draft_id` when a draft existed | `ok, channel, ts, message{user,type,ts,client_msg_id,text,team,blocks}` | `user_typing` out before; `message` (with `client_msg_id`, `source_team`, `user_team`, `suppress_notification`) at +137 ms; `channel_marked` for the sender (unread 0) | `08`, `09` |
| Thread reply | `chat.postMessage` 209 ms | as above + `thread_ts`, `reply_broadcast=false` | `message` gains `thread_ts`, `parent_user_id` | `message` subtype `message_replied` (parent with `reply_count`, `reply_users`, `latest_reply`, `is_locked`) → `message` (the reply, with `thread_ts`) → `channel_marked` → `thread_subscribed` (`subscription{type,channel,thread_ts,active,last_read}`) → `update_global_thread_state` → `badge_counts_updated` → `activity` subtype `activity_deleted` → `update_global_thread_state` | `15` |
| Open thread | `subscriptions.thread.get` then `conversations.replies` (`ts`, `oldest`, `inclusive=true`, `limit=28`, `cached_latest_updates`) 330 ms | | `ok, messages, has_more, unchanged_messages, latest_updates` | `tickle` only | `14` |
| Edit | `chat.update` 156 ms | `channel`, `ts`, `blocks`, `skip_dlp_user_warning=false`, `_x_reason=saveMessageEdit` | `ok, channel, ts, text, message{…edited{user,ts}}` | `message` subtype `message_changed`, `hidden: true`, with `message` and `previous_message` | `17` |
| Delete | `chat.delete` 171 ms | `channel`, `ts` | `ok, channel, ts` | `message` subtype `message_deleted`, `hidden: true`, `deleted_ts`, `previous_message`; then the client calls `messages.list` for that `ts` (returns `messages`, `messages_data`) | `22` |
| Reaction | `reactions.add` 468 ms | `channel`, `name`, `timestamp` | `ok` | `reaction_added` (`user`, `reaction`, `item{type,channel,ts}`, `item_user`, `event_ts`, `ts`) | `12` |
| File attach + send | `files.getUploadURL` (`filename`, `length`) → PUT `files.slack.com/upload/v1/<opaque>` (body = file, 286 ms) → `files.completeUpload` (`files=[{id,title}]`) → `files.info` → `drafts.create` (`file_ids`, `destinations`) → on send **`files.share`** (`channel`, `files`, `blocks`, `client_msg_id`, `draft_id`, `broadcast=false`) 325 ms; not `chat.postMessage` | | `getUploadURL: ok, file, upload_url`; `share: ok, file_msg_ts` | after upload: `file_created`, `draft_create`; after share: `message` (with `files[]`, `upload:false`, `display_as_bot`), `file_public`, `file_shared` (`channel_id`), `channel_marked`, `draft_send`, `channel_updated` ×2 (channel tabs gained "files") | `23`, `24` |
| Mark unread | `conversations.mark` (`channel`, `ts` = previous message's ts, `_x_reason=back`) 191 ms | | `ok` | `badge_counts_updated`, `channel_marked` (`unread_count: 1`, `ts` = the mark) | `18` |
| Re-enter channel | none | | | — the channel stayed unread after switching away and back; what triggers the client's own read mark is unresolved | `19`, `20` |
| Typing | socket only: `{"type":"user_typing","channel":…,"id":N}`; in a thread also `thread_ts` | | no reply | | `08`, `15` |
| Presence | `presence_sub` with `ids` (self, plus the DM peer when a DM is open); `presence_change` `{presence: active\|away, users:[…]}` | | | | `05`, `19` |
| Activity | `tickle` `{reason: focus\|mousedown\|keydown, id}` on user input; server answers nothing | | | | any |

**Message shape** (socket `message` event and HTTP `message`): `type`,
`channel`, `text`, `blocks[]` (rich_text with `block_id`), `user`, `team`,
`client_msg_id`, `ts`, `event_ts`, `source_team`, `user_team`,
`suppress_notification`; replies add `thread_ts` and `parent_user_id`; file
posts add `files[]`, `upload`, `display_as_bot`. Edited messages carry
`edited{user, ts}`. Deletions and edits are `hidden: true` subtypes of
`message`. The `ts` string is the identity everywhere (`deleted_ts`,
`item.ts`, `thread_ts`); the provisional `ts` sent on `chat.postMessage` shows
the client never trusts its own clock for it.

**Permission and failure behaviour.** Not observed: every call returned 200
and no error frame appeared. The client does call `edgeapi permissions/info`
(`channel_id`, `user_id`, `permissions`) before acting in a channel, and
`files.channelSettingsAllowDownloads` before sharing a file, so it
pre-checks rather than relying on errors. Unresolved (§7).

## 6. Public API baseline check (spec "Public API baseline and feature mapping")

Sources: Slack docs fetched 2026-09-11 (rate limits, Events API, Socket Mode,
`conversations.history`, RTM availability, PKCE) and the live #543 run.

| Assumption in the spec | Result |
| --- | --- |
| Events API via HTTP or Socket Mode, not a copy of the client stream | Confirmed by docs. Ack within 3 s with 2xx; up to 3 retries (immediate, 1 min, 5 min) with `x-slack-retry-num`/`x-slack-retry-reason`; 30,000 deliveries per workspace per app per hour, then `app_rate_limited`. Socket Mode: `apps.connections.open` with an `xapp-` token, envelope `{envelope_id, payload, type, accepts_response_payload}`, ack each envelope, `disconnect` with `link_disabled`/`warning`/`refresh_requested`, up to 10 connections, **no ordering or replay guarantee**. Live (#543): signed `url_verification`, `tokens_revoked`, `app_uninstalled` delivered and verified. |
| Signature/replay handling | Docs: HMAC signature over timestamp + body; #543 verified a forged signature is refused. The replay window is enforced by the connector (not re-measured here). |
| No legacy RTM | Confirmed: "The RTM API isn't available for modern granular-permissions apps". |
| Rate budgets per app/team/method | Confirmed: tiers 1–4 (1+/20+/50+/100+ per minute), evaluated per method per workspace per app, `429` + `Retry-After` seconds. |
| Tighter history limits for new non-Marketplace apps | Docs: apps created after **2025-05-29** that are commercially distributed and not Marketplace-approved get **1 request per minute** and **15 objects per request** on `conversations.history` and `conversations.replies` (normal: tier 3, `limit` up to 999). The test app was created 2026-09-11, so it is in the affected cohort **if** classified as commercially distributed. |
| PKCE refresh without secret | **Contradicted live** (#543): refresh needs `client_secret`. |
| User-token posts carry only `user` | **Contradicted live** (#543): the app's `bot_id`/`app_id`/`bot_profile` appear next to `user`. |

**Not measured, and why.** Measuring the history/replies capacity and reading
the app's classification needs (a) the test app to carry the user scopes
`channels:history`, `groups:history`, `im:history`, `mpim:history`,
`channels:read`, `groups:read`, `im:read`, `mpim:read`, `users:read` (the
current manifest has only `chat:write`), a re-authorization, and a scripted
probe that counts 429s over a minute; and (b) the app's "Distribution" page on
`api.slack.com`, which the browser extension cannot open. Both are operator
actions. Until they are done, **no history experience may be promised**
(acceptance rule). Recorded as a blocker in the matrix, not as a gap.

## 7. Capability × platform feasibility matrix (spec area 5)

Legend. *Public*: public Web API / Events API with the #543 connector grant.
*Internal*: the client protocol as observed above, confidence H/M/L with the
fixture. *Web / macOS / iOS*: what Flow could ship on that platform today, one
of **public-API supported**, **internal-protocol observed** (usable only once
the first-party session dependency in §2 is resolved), or **blocked** with the
concrete blocker. Observed client: web, 2026-09-11, build 1789166259.

| Capability | Public API | Internal protocol (observed) | Web | macOS | iOS | Unresolved |
| --- | --- | --- | --- | --- | --- | --- |
| Workspace, users, conversations | `auth.test` (live #543), `users.*`, `conversations.list` need `users:read`, `*:read` (not yet granted) | `client.init`/`client.channels`/`client.counts` + `edgeapi` cache — H for names and order, L for bodies (`session2`, v1) | public-API supported (once scopes granted) | same | same | bodies of `client.channels`; `edgeapi` semantics vs `users.list` |
| History | `conversations.history` needs `*:history`; capacity **unmeasured**; possibly 1/min + 15 objects | `conversations.history` with client fields and conditional fetch — H (`01`, `20`) | blocked: scopes not granted and capacity unmeasured (§6) | same | same | app classification; pagination (not exercised) |
| Threads | `conversations.replies`, same limit cohort | `subscriptions.thread.get` + `conversations.replies`; `message_replied`, `thread_subscribed` — H (`14`, `15`) | blocked as History | same | same | thread subscription semantics for other users' threads |
| Send as user | `chat.postMessage` live (#543); authorship = `message.user`, `bot_id` present | `chat.postMessage` with provisional `ts`, echo-before-response — H (`08`) | public-API supported | public-API supported | public-API supported | none for public; `xArgs`/`draft_id` for internal |
| Edit / delete | `chat.update`, `chat.delete` (scope `chat:write`; not live-tested) | `chat.update`, `chat.delete`, hidden `message_changed`/`message_deleted` — H (`17`, `22`) | public-API supported (pending live test) | same | same | live test of public edit/delete |
| Reactions | `reactions.add`/`remove` need `reactions:write`; `reaction_added` event needs `reactions:read` subscription | `reactions.add` + `reaction_added` — H (`12`) | blocked: scope not granted | same | same | — |
| Files | `files.getUploadURLExternal`/`completeUploadExternal` need `files:write`; download URLs need `files:read` | `files.getUploadURL` → signed PUT → `completeUpload` → `files.share` — H (`23`, `24`) | blocked: scope not granted | same | same | whether public upload can attach to a message identically to `files.share` |
| Search | `search.messages` needs `search:read` (user token only) | not observed | blocked: scope not granted | same | same | — |
| Unread / read state | `conversations.mark` needs the conversation write scopes (docs); `channel_marked`-class events are **not** in the Events API, so another device's read mark is invisible | `conversations.mark`, `channel_marked`, `client.counts`, `badge_counts_updated` — H for own marks (`18`); L for cross-device | blocked: cross-device read cursors only exist on the internal stream | same | same | what triggers the client's automatic mark on re-entry |
| Live updates | Events API: `message.*` etc. need history scopes + event subscriptions; routed per grant; no ordering guarantee | socket stream — H for envelope/heartbeat/reconnect (`05`, `06`, `session2`), L for gap fill | internal-protocol observed; blocked for Flow by the session dependency; Events API viable once scopes/events granted | same | same | gap fill; server idle timeout |
| Typing | none in public API | `user_typing` out; inbound not observed | blocked (no public API); internal observed one-way | same | same | inbound `user_typing` shape |
| Presence | `users.getPresence` (polling, `users:read`) | `presence_sub`/`presence_change` — H (`05`) | public: polling only; internal observed | same | same | subscription limits |
| Notifications / push | connector translates authorized events (spec) | not observed (web client uses its own service worker) | see spec "Notifications and parity" | blocked pending Events coverage | blocked pending Events coverage | — |
| Huddles, canvases, workflows | none | separate services (`huddles/*`, `/canvas/collab/*` with its own token) | Open in Slack | Open in Slack | Open in Slack | — |

**Platform notes.** The "internal-protocol observed" cells are identical
across web, macOS, and iOS on purpose: nothing was tested natively, and the
spec forbids inferring native feasibility from a browser test. The blocker
is the same everywhere: the protocol needs an `xoxc-` session with its
cookies and boot state, which only Slack's own clients obtain. For the Flow
web client there is an additional, untested obstacle: `app.freeflow.im` is a
different origin from `*.slack.com`, so cookies and CORS would apply even
with a session. Both stay recorded blockers until a supported session flow
is designed and approved (operator decision), or Slack publishes an
equivalent public interface.

## 8. Next bounded experiments

1. Grant the read scopes on the test app, re-authorize, and run a scripted
   probe of `conversations.history`/`replies` for one minute; record the
   429 pattern and the app's Distribution page state. This unblocks History,
   Threads, Reactions, Files, Search rows.
2. Two-account run in `#testing`: second account posts, edits, reacts, and
   types while the first client is (a) connected, (b) disconnected for 30 s,
   (c) disconnected past the ~96 s deadline. Diff what arrives on the socket
   after reconnect against `client.counts`/history to settle gap fill.
3. Cold reload with the hook injected before `client.init` (needs a
   pre-load injection path; the extension cannot do it) to capture
   `client.init`/`client.channels`/`client.counts` bodies.
4. Public-API live test of `chat.update`, `chat.delete`, and
   `reactions.add` through the connector; compare event shapes with the
   internal fixtures.
5. Design review of a supported first-party session flow (or a decision not
   to pursue one) before any internal-protocol implementation work.

## Appendix: reproducing a capture

1. Sign in to the test workspace in Chrome; open `#testing`.
2. Inject `tools/capture-hook.js` (paste into the console or run it via the
   extension's JavaScript tool). It returns `installed`.
3. Before each action run `__flowCap.mark('<label>')`; perform the action.
4. Export: `__flowCap.dump().data` as a JSON download, saved outside the repo.
5. `node tools/sanitize.mjs <raw.json> fixtures/<date> --map <scratch>/id-map.json`
   and review every file before committing. The id map never enters the repo.
