# Slack client protocol: first browser observation

Observed: 2026-09-09, signed-in Slack web client in local Chrome DevTools.
Status: Partial protocol inventory, not an implemented or validated Slack adapter.

## Method and evidence limits

Used the user's signed-in workspace, inspected the existing page, opened DevTools,
and reloaded once with Network recording enabled. Observations below come from
request rows, Payload/Preview panels, WebSocket Messages, and client console logs.
No messages were posted, reactions added, or API requests manually replayed.
The official client itself performs ordinary presence/read-state work on load/focus;
this was not a guarantee of zero server-side state changes.

Only endpoint patterns, field names, control-message shapes and protocol options
are retained here. No raw HAR, credentials, cookies, full socket URLs, message
content, workspace/member identifiers, or private profile data are stored.
The companion JSON contains manually reconstructed illustrative frames, not raw
captures. Unparsed/truncated frames were excluded rather than guessed.

This was one workspace and one warm reload, with service-worker caching active.
The workspace is not asserted to be a disposable test environment. Mutation tests
need a separately identified test conversation and explicit send authorization.

## Observed transport map

| Surface | Observation | Confidence / limit |
| --- | --- | --- |
| App navigation | `https://app.slack.com/client/<team>/<channel>` | Direct UI observation |
| Workspace APIs | `https://<workspace>.slack.com/api/<method>` | Network rows |
| Entity cache | `https://edgeapi.slack.com/cache/<team>/<resource>/<operation>` | Network rows; not an OAuth-access claim |
| Live connection | `wss://wss-primary.slack.com/` with HTTP 101 | One observed connection, not a complete host list |
| Static boot | Service worker serves `/boot/client-v2.html` and versioned Slack CDN assets | Console logs; warm-cache behavior |

Workspace API request inventory included:

- Bootstrap: `client.init`, `client.channels`, `client.extras`, `client.counts`,
  `client.shouldReload`, `api.features`, `features.access.policies.list`.
- Conversation/content: `conversations.view`, `conversations.history`,
  `conversations.listPrefs`, `messages.list`, `drafts.list`, `drafts.listActive`.
- Other state: `activity.views`, `users.interactions.list`, `dnd.info`, `dnd.teamInfo`.

Names alone do not prove method semantics or interchangeability with public APIs.
Observed cache paths included `permissions/info`, `users/info`, `users/list`,
`users/counts`, `channels/membership`, and `huddles/info`. Client logs called one
entity-fetch path “Flannel channels/info” and showed a subsequent
`conversations.genericInfo` call with a fallback reason. The cause of that fallback
was not established.

## Bootstrap and authentication boundary

`client.init` was a POST returning 200 with a JSON object. Its request Payload
showed Form Data with a `token` field, `include_relevant_onboarding`, `_x_reason`,
`_x_sonic`, and `_x_app_name`. Query parameter names included `_x_id`,
`_x_version_ts`, `_x_foreground`, `_x_frontend_build_type`, `_x_desktop_ia`,
`_x_gantry`, `fp`, and `_x_num_retries`. Their necessity was not tested.

Top-level response keys observed:

```
ok, account_types, cache_version, image_proxy_url,
mobile_app_requires_upgrade, prefs, prefs_version, reload_info,
self, slack_route, team, workspaces
```

The socket URL carried a first-party token with the `xoxc` prefix. Its non-secret
option names included `sync_desync`, `slack_client`, `start_args`,
`no_query_on_subscribe`, `flannel`, `lazy_channels`, `gateway_server`, and
`batch_presence_aware`. The observed values included `flannel=3`,
`lazy_channels=1`, and `batch_presence_aware=1`. Nested start-argument names
included `agent`, `org_wide_aware`, `agent_version`, `eac_cache_ts`, `cache_ts`,
`name_tagging`, `only_self_subteams`, `connect_only`, and `ms_latest`.

Do not store or log full socket URLs: they contain credentials. This observation
does **not** show that an OAuth user token can substitute for the first-party token,
that the token works without cookies, or how to acquire/refresh a compatible
session for Flow. No cookies were extracted or OAuth substitution attempted.
Those remain authentication feasibility questions, not implementation details
that can safely be filled in from these traces.

## Live JSON protocol

| Direction | Type | Observed keys / behavior |
| --- | --- | --- |
| Server → client | `hello` | `type`, `fast_reconnect`, `region`, `start`, `host_id`; fast_reconnect was false |
| Client → server | `subscription_update` | `type`, `subtype`, `ids`, `id`; subtype `user_change_subscribe_request` |
| Server → client | `subscription_update` | `ok`, `reply_to`, `type`, `subtype`, `ids`; subtype `user_change_subscribe_response` |
| Client → server | `presence_sub` | `type`, `ids`, `id` |
| Server → client | `presence_change` | `type`, `presence`, `users` |
| Server → client | `user_interaction_changed` | `type`, `interaction`, `event_ts` |
| Client → server | `ping` | `type`, `id` |
| Server → client | `pong` | `type`, `reply_to`; matches the ping id |

Initial visible frames included hello, explicit user-change subscriptions,
presence subscription, acknowledgments, presence events, and recurring heartbeat
pairs. Numeric request IDs are observed; this does not establish a global sequence
number, replay cursor, delivery guarantee, or universal acknowledgment convention.
Heartbeat cadence and deadlines were not measured. No new-message stream, mutation
acknowledgment, channel subscription, reconnect/resume, or gap-repair protocol was
validated in this pass.

## Unread state

`client.counts` appeared during reload and again later. Console logs explicitly
identified a timeout-driven counts poll and application of counts while connected.
A live socket therefore does not eliminate HTTP reconciliation in this client.

Top-level keys in a counts response:

```
ok, activity_v2, alerts, channel_badges, channels, counts_last_fetched,
file_channels, ims, mpims, saved, threads
```

An inspected member of the `channels` array had:

```
has_unreads, history_invalid, id, last_read, latest, mention_count, updated
```

The console also reported that an already-read visible channel was not marked
because `last_read >= latest`. This is an observed client condition, not a complete
read-mark protocol. Timestamp representation and ordering need dedicated tests.

## Implications for Flow

1. Model Slack as a composite transport: workspace HTTP APIs, an entity-cache
   service, and a subscribed WebSocket stream. Do not equate Slack with one base URL.
2. Separate bootstrap identity/preferences, conversation hydration, and unread
   reconciliation. Reuse public methods only after verifying matching semantics.
3. Build a socket request correlator for the verified id/reply_to pairs and an
   explicit subscription manager. Keep gap recovery a separate unresolved feature.
4. Gate private transport work on authentication feasibility. A working signed-in
   Slack tab is not evidence that the proposed OAuth connector can reproduce it.
5. Preserve rate budgets and capability degradation; observed internal endpoints
   are not a reason to assume public scope or rate restrictions disappear.

## Next bounded experiments

- In a designated test conversation, correlate navigation with history payloads,
  entity hydration, channel subscriptions, and read-state updates.
- With explicit test-message authorization, observe one send, one thread reply,
  edit, delete, and reaction; reconcile HTTP results with socket echoes.
- Measure heartbeats and controlled reload/reconnect behavior; distinguish full
  bootstrap from fast reconnect, and establish how missed events are repaired.
- Using a separately authorized Slack app and OAuth grant, test a minimal read-only
  compatibility matrix; report permission/authentication failures without attempting
  to bypass them or borrowing the browser's credentials.
- Validate native and browser authentication/transport feasibility independently
  before choosing connector versus device-local ownership.
