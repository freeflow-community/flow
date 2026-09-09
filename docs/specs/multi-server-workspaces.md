# Multi-server workspaces

Status: Draft proposal · 2026-09-09
Platforms: web, macOS, iOS

## Outcome and scope

A person can add a workspace hosted on another Flow backend or on Slack,
authenticate with that provider, and use it alongside existing workspaces in the
same client. Slack support includes OAuth and an explicit workstream to decode
and implement its internal client communications protocol.
Switching workspaces automatically selects the owning backend and identity.
Signing out of or losing connectivity to one backend does not affect others.

Example: Scott uses Product on app.freeflow.im and Research on flow.example.com.
He signs in separately to each server, potentially with different email addresses.
Both workspaces appear in the switcher. Messages, uploads, search, unread counts,
and huddles always use the selected workspace's server and account.

Required by this feature: additional servers and independent authentication on
all three clients. The remaining decisions below are proposed defaults, subject
to product review; this document does not describe shipped functionality.

V1 supports one signed-in account per Flow server per client profile, and multiple
selected workspaces from that account. Slack supports one account per Slack team
per profile, with independent connections to multiple teams. It does not federate servers, move existing
workspaces, merge identities, share membership, or provide cross-server search
or DMs. Adding a workspace means connecting to its existing host, not changing
where the workspace's data lives. Connection settings are local to each device
or browser profile in V1.

## User experience

The workspace switcher lists all added workspaces, grouped by server, with a
server hostname and signed-in account visible in each group. Duplicate workspace
names remain distinguishable. Each workspace shows its own unread indicator;
each server group can show Offline or Sign in required.

**Add workspace** offers the current server's workspaces, **Connect another Flow
server**, and **Connect Slack**. Slack follows the provider flow below. The Flow
server option accepts a server URL or Flow workspace invite URL:

1. Normalize the address and check that it is a compatible Flow backend.
2. Display the destination hostname before asking for credentials. Backend names
   and logos are supplemental; they cannot hide the actual destination.
3. Authenticate using that server's advertised sign-in methods. Do not prefill or
   submit another server's password or session. Existing provider browser sessions
   may simplify provider login, but the backend still issues its own Flow session.
4. List workspaces available to that identity; select one or more to add. An invite
   instead completes the join on its issuing server before adding the workspace.
5. Select the newly added workspace. Canceling leaves existing connections intact.

An already connected origin reuses its session and opens its workspace chooser.
If the account belongs to no workspaces, show the server's supported create/join
options, or an explanation that membership is required. Adding a connection does
not imply permission to create a workspace or register an account.

Switching restores that workspace's navigation, drafts, and scroll position.
An unavailable server shows its cached workspace with an offline state; other
servers remain usable. V1 does not introduce offline mutation queues. A session
expiry shows a server-specific sign-in action and preserves workspace labels,
but authenticated cached content is hidden until sign-in succeeds.

Connection management distinguishes:

- **Hide workspace:** remove its local switcher entry; do not leave membership.
- **Sign out of [server]:** revoke that session when reachable, clear its local
  credentials and private caches, and keep server/workspace labels for sign-in.
- **Remove server:** perform local sign-out cleanup and remove its entries.
- **Leave workspace / Delete account:** existing server-side actions, scoped to
  the explicitly displayed server and identity. Never reinterpret these as local
  removal. Account deletion affects all of that account's workspaces on that server.

If remote revocation is unavailable, local sign-out still completes; do not
claim the remote session was revoked. Signing back in as another user clears the
previous identity's workspace bindings and loads the new user's memberships.

## Connection and identity model

Persist a versioned connection registry, without embedding credentials:

| Record | Required fields |
| --- | --- |
| ServerConnection | local connectionId, provider (`flow` or `slack`), provider identity, canonical origin/transport endpoint, display label, API/capability version |
| ServerSession | connectionId, server-issued userId, credential reference, auth generation, status |
| WorkspaceBinding | connectionId, userId, workspaceId, cached name, local visibility/order |
| NavigationTarget | connectionId, userId, workspaceId, optional channel/message/thread/artifact ids |

For Flow connections, canonical origin includes scheme, lowercased hostname, and effective port.
Normalize default ports and trailing slash. V1 requires an origin-root deployment;
reject userinfo, query strings, fragments, and non-root paths in server address
input (parse known invite links separately). Require HTTPS in release clients;
HTTP loopback is an explicit development allowance. Do not bypass certificate
validation. Private-network HTTPS deployments are allowed when reachable, subject
to browser/OS network permissions. Redirected discovery never silently changes
which server receives credentials: display and confirm the destination first.

The local connectionId is stable and is not an authentication claim. A server
cannot declare itself equivalent to another connection through discovery metadata.
Changing an origin creates a new connection in V1; server migration is separate.
Never assume UUIDs are globally unique across independent or cloned databases.

Every credential, cache key, object URL, database, sync cursor, navigation entry,
draft, notification, and read marker is scoped by connection and identity. Workspace
resources add workspaceId. Token replacement increments auth generation so a late
401 from an old request cannot invalidate a newly authenticated session.

## Runtime architecture

Introduce a ConnectionManager that owns a session runtime per connection. Each
runtime owns an API client, authenticated socket/sync state, caches, and current
identity. Views receive an explicit workspace context referencing that runtime.
An operation captures its context when started; switching workspaces must never
retarget an upload, pending send, read receipt, or response to another server.

REST, WebSocket, avatar/blob fetches, presigned-upload fallback paths, downloads,
link previews, mini-app tokens, and huddle credentials must all use this context.
Relative API/media URLs resolve against the owning backend, not the web page's
origin. Only attach the backend bearer to that exact origin; never to external
presigned storage URLs or cross-origin redirects. API helpers accept relative API
paths, not arbitrary authenticated absolute URLs.

Maintain background synchronization for connected sessions while web/macOS is
running, using the existing subscription model for added workspaces. Reconnect
backoff, rate limits, errors, and authorization failures are independent per
connection. iOS follows its existing foreground/background lifecycle and uses
push when suspended. No continuously running background sockets are promised.
Bound concurrency and reconnect with jitter; avoid eager transcript downloads for
all workspaces. Aggregate switcher unread state from per-connection values.

Support independent selected workspaces in native windows and browser tabs.
Sign-out propagates to other windows/tabs for that connection only. Dispose its
sockets, queries, object URLs, databases/caches and pending operations on removal.
Late responses must not recreate removed state.

Keep one joined huddle per client instance in V1. A workspace switch may leave the
existing huddle running with its original context and a visible return control.
Joining another requires the existing leave/join transition. Huddle invitations
and notification actions must carry the owning connection context.

## Flow backend and browser contract

Add an unauthenticated, versioned `GET /v1/client-info` discovery endpoint. Proposed
response: protocol version, display name, supported auth methods, registration
availability, and capabilities for browser connections, auth handoff, and push.
Keep REST and socket routes on the entered origin in V1. Expose no secrets or
private workspace list. Unknown optional capabilities are ignored; incompatible
protocol versions give an actionable error before authentication.

Existing login and membership endpoints remain authoritative. Password, email-link,
Google, and Apple are enabled only when supported/configured by that backend.
Provider configuration belongs to the target backend; it must validate the correct
audience and issuer. Do not assume the primary deployment's OAuth configuration
works for independently operated servers.

For Flow providers, web connects directly from its hosting origin to each backend. Add operator-managed
allowed web origins with exact-origin CORS handling, OPTIONS support, appropriate
methods and headers (including Authorization and Content-Type), and Vary: Origin.
Apply this to discovery, authentication, APIs, and proxied media. Use bearer auth
without ambient cross-origin cookies. Validate browser WebSocket Origin separately;
CORS is not a WebSocket authorization mechanism. Native clients continue to require
authentication even though they do not use browser CORS.

The web client's deployment CSP must permit supported HTTPS/WSS destinations and
required media; align storage CORS for presigned uploads too. A backend rejecting
the web origin is reported as a browser-connection configuration problem, with
operator guidance. Do not add a central server proxy for arbitrary backend URLs.
Browser mixed-content or private-network restrictions may make a backend usable
only from native clients; describe the actual failure instead of reporting bad
credentials.

For provider or email authentication that opens the backend's web page, extend the
existing app-link handoff into a connection-bound flow: client-generated state and
PKCE challenge, short-lived single-use authorization code, exact allowlisted return
destination, and verifier-bound exchange against the initiating origin. Bind state
to connection, origin, and operation; reject unsolicited/mismatched callbacks.
Never place session tokens in URLs. Web popup messages require exact origin and
source checks. Native flow:// callbacks must resolve a pending operation rather
than trust a callback-supplied server URL. Expired email flows may restart sign-in
on the issuing server. Clean callback codes from browser history after handling.

## Notifications and native extensions

For Flow providers, register each device with each authenticated backend separately.
Slack notification transport and registrations are specified in its provider section. Registration
includes an opaque client-generated routing identifier unique to that connection
and identity; backend pushes echo it. Map it locally rather than accepting a
push-supplied URL. Unknown/removed identifiers cannot add connections or navigate.
Scope notification IDs, deduplication, suppression while viewing, and mark-read
operations to the same connection. Unregister only the relevant registration on
sign-out; ignore stale pushes if remote unregister failed.

Independent backends cannot each write a correct global `aps.badge`: the last push
would overwrite the others. V1 multi-server registrations request alert delivery
without a backend-owned absolute badge. The client aggregates last-known counts
when running and reconciles on foreground. An exact aggregate icon badge while iOS
is suspended is explicitly not guaranteed; no central push aggregator is proposed.
Legacy registrations retain existing behavior. Decide whether this badge limitation
is acceptable before implementation is considered ready for release.

The iOS share extension reads the registry from the app group, shows workspace
and hostname, and loads only the selected connection's Keychain credential. It
must not fall back to the build-time default server. Audit notification extensions,
attachment downloads, deep links, and native windows for the same assumption.
Custom servers without configured APNs delivery advertise that limitation; the
client does not promise background notifications for them. Sharing production APNs
credentials with arbitrary backend operators is outside this feature.

## Slack provider

### Product contract

Slack workspaces appear in the same switcher as Flow workspaces, labeled Slack,
with workspace name/domain and signed-in Slack identity. Connecting Slack does not
create a mirrored Flow workspace or import its members as Flow accounts. Slack
remains authoritative for content, membership, retention, and permissions.

**Connect Slack** opens Slack's authorization UI in a browser; optionally accept a
workspace URL as a hint. After authorization, validate the actual team and user
returned, show them, then add the workspace. A hint is not proof of which team was
authorized. Handle workspace app approval, denied consent, canceled login, expired
credentials, and missing permissions as distinct states. Never ask the user to
enter their Slack password into a Flow form. Signing out disconnects Flow's Slack
session; it does not globally sign the user out of Slack or uninstall a shared app.

The initial target is everyday chat: channel/DM lists, history, threads, sending
as the authenticated user, edits/deletes permitted by Slack, reactions, attachments,
and live updates. Search, unread synchronization, typing, presence, and notifications
must have individually verified capabilities. Slack huddles, calls, canvases,
workflows, administration, and interactive app blocks may open in Slack until an
adapter implementation is validated. Do not display Flow-only controls such as
agent invitations or mini-app identity minting in a Slack workspace.

OAuth integration and internal-protocol compatibility are both in scope. A working
public-API subset is an incremental milestone, not completion of the internal
protocol workstream. Full Slack-client parity is not presumed by this draft.

### Provider abstraction and identity

Introduce a WorkspaceBackend interface implemented by FlowBackend and SlackBackend.
It exposes authentication state, capabilities, workspace/conversation listing,
history and thread pagination, mutations, media, search, read state, and a normalized
event stream. UI components consume it rather than constructing Flow REST paths.
SlackBackend has separate public-API and internal-protocol transports behind the
same interface; protocol-specific payloads stay out of shared UI models.

A Slack provider identity is `(environment, enterpriseId?, teamId, userId)`; persist
installation/grant identifiers separately. Use immutable IDs returned by Slack,
not workspace domain or email. Multiple teams at `slack.com` must not deduplicate
into one connection. An enterprise grant does not automatically authorize every
team; bind only verified accessible teams. V1 targets standard Slack; GovSlack
requires its own tested environment configuration before it is advertised.

Preserve provider-native IDs as strings. A Slack message key includes connection,
team, channel, and the exact `ts` string; never convert it through floating point
or manufacture a Flow UUID as its authoritative identifier. Preserve `thread_ts`,
provider cursors, message subtypes, and provenance. Normalize Slack mrkdwn, mentions,
rich text, edits, deletions, and attachments with fixture-tested conversions.
Unknown blocks get a safe textual fallback and Open in Slack action. Slack Connect
conversations retain their local team context; do not merge records across teams
based on a shared name or apparent duplicate content.

The existing `packages/server/src/slackcompat/` implements Slack-shaped endpoints
for apps talking to Flow. It is the opposite direction from this feature. Reuse
validated formatting utilities where useful, but build a distinct outbound Slack
adapter rather than treating that compatibility layer as a Slack client.

### OAuth and transport ownership

Use Slack OAuth authorization for API access as the Slack user. Identity-only
Sign in with Slack does not establish chat permissions. The standard app flow uses
`oauth/v2/authorize`, requested `user_scope`, and `oauth.v2.access`; persist the
returned user grant and granted scopes independently of any bot grant. Slack also
documents a user-specific OAuth flow; select and test the flow appropriate to the
app configuration during the prototype. [OAuth documentation](https://docs.slack.dev/authentication/installing-with-oauth/),
[Sign in with Slack](https://docs.slack.dev/authentication/sign-in-with-slack/).

Proposed deployment: a dedicated Slack connector service handles OAuth exchange,
credential rotation, API operations, and event delivery for all three clients.
It may be operated with Flow or self-hosted, but its address and data handling role
are explicit connection configuration. This is a provider-specific service, not an
arbitrary URL proxy or a requirement that other Flow servers relay Slack content.
Clients receive connection-scoped connector credentials, never an app-wide Slack
secret. User access/refresh tokens live encrypted in the connector credential store.
Keep Slack grants separate from a Flow login; connector authentication must not
require membership in a mirrored Flow workspace. Connection discovery remains
local even though its encrypted grant and runtime state are held by the connector.

The connector terminates the Slack HTTPS callback, validates one-use state, and
returns a short-lived, verifier-bound Flow handoff to the initiating web/native
client. Implement Slack-leg PKCE according to the selected flow's documented
support; do not assume Flow's handoff verifier also secures the Slack leg.
[Slack PKCE documentation](https://docs.slack.dev/authentication/using-pkce/).

Create a checked-in scope manifest mapping each enabled capability to method,
token type, scope, and required event subscription. Request the minimum scopes for
the selected feature set and honor partial grants. Verify sending uses the user's
identity; never silently substitute bot authorship. Handle token refresh atomically,
revocation, app removal, account deactivation, and reauthorization. Multiple local
clients may share one upstream grant: a device disconnect removes its connector
session without revoking another client's grant or uninstalling the app.

The connector is a new trust boundary: explain that it handles Slack credentials
and content, isolate users and grants, avoid message/token logging, and bound any
transient event replay retention. It is not a permanent Slack archive. The prototype
must establish distribution/app-approval requirements and whether the intended
hosting model can support the needed grants and events before rollout.

### Public API baseline and feature mapping

These are implementation candidates, not claims that every grant permits them.
The prototype resolves exact scopes and token compatibility in the manifest.

| Capability | Public API baseline | Internal protocol investigation |
| --- | --- | --- |
| Workspace/users/conversations | auth/team/user and Conversations APIs | Client bootstrap, sidebar ordering, subscriptions |
| History and threads | conversations.history / conversations.replies | Incremental history, thread hydration, gap repair |
| Send/edit/delete | chat methods with user authorization | Acknowledgements, client IDs, retry reconciliation |
| Reactions | reactions methods and events | Live changes and reconciliation |
| Files | Current Slack upload/download interfaces | Attachment metadata and client previews |
| Search | Scoped Slack search where available | Client query/result semantics |
| Unread/read state | Validate available read-marker methods | Cross-device read cursors and unread counts |
| Live updates | Events API via connector | Slack client stream, sequencing, resume, typing/presence |
| Huddles and rich app surfaces | Open in Slack initially | Separate protocol/media feasibility; no Flow LiveKit reuse |

The Events API delivers subscribed, authorized events through HTTP or Socket Mode;
it is not assumed to be a complete copy of a user's Slack client stream. Route each
event only to user grants authorized for that conversation, not all connector users
in the same team. Verify event signatures/replay windows for HTTP and acknowledge
according to Slack's contract. [Events API](https://docs.slack.dev/apis/events-api/).
Modern granular-permission apps cannot use legacy RTM, so `rtm.connect` is not the
plan for obtaining full client behavior. [RTM availability](https://docs.slack.dev/tools/node-slack-sdk/rtm-api/).

Rate budgets belong to app/team/method, not only a local connection. Share budgets
across connector sessions; honor Retry-After, paginate lazily, prioritize the visible
conversation, and show delayed history/sync honestly. New commercially distributed
non-Marketplace apps face tighter history/replies limits; record the actual app
classification and measured capacity before promising a usable history experience.
[Rate limits](https://docs.slack.dev/apis/web-api/rate-limits/).

### Decode Slack's internal communications protocol

The [first browser observation](../design/slack-protocol/README.md) records the
2026-09-09 HTTP/bootstrap inventory, first-party socket authentication boundary,
control frames, and counts schema. It is partial evidence, not a completed adapter
or proof of OAuth compatibility.

Run a bounded interoperability investigation using a dedicated Slack test workspace,
accounts controlled by the team, and synthetic conversations. This spec authorizes
planning that work; it does not claim any private endpoint has already been decoded.
Observe the official client's requests and event frames while performing repeatable
actions, then correlate each action with bootstrap calls, payloads, responses, and
stream events. Start read-only; test mutations only against disposable test content.

Deliver a versioned protocol notebook and sanitized replay fixtures covering:

1. Authentication material actually required by each interface, its origin and
   lifecycle, and whether the OAuth user grant works. Do not assume OAuth tokens
   are interchangeable with a Slack first-party web session.
2. Bootstrap requests, workspace/user identity, conversation discovery, initial
   read state, websocket negotiation, and any transport/compression framing.
3. Event envelopes, heartbeat, acknowledgements, ordering, duplicate delivery,
   reconnect/resume behavior, and how the official client detects/fills gaps.
4. Message/thread shapes, mutations, attachment references, read markers, typing,
   presence, and their permission/failure behavior.
5. A public-versus-internal capability matrix, with an observed client version/date,
   confidence level, sample fixtures, and unresolved questions for each entry.

Do not invent endpoint names or replay semantics from similarity to Flow or RTM.
No actual production messages, session cookies, tokens, or signed media URLs belong
in the repository. Investigation stays within the test accounts' permissions and
does not bypass SSO, workspace approval, or access controls. If an interface requires
a distinct first-party session, report that as a concrete authentication dependency
and design an explicit supported session flow before implementation; do not silently
extract credentials from an existing browser profile or convert an OAuth denial into
an alternate access path.

A credential or transport that works in a native test may not work in web/iOS.
Test browser origin/cookie restrictions and native session acquisition independently.
The connector proposal is not proof it can use the private protocol. A required
session that cannot be acquired and renewed reliably across the intended deployment
is a recorded blocker for that capability, not a reason to claim protocol completion.

Implement verified internal interfaces behind a versioned adapter and capability
switches. Validate payloads, tolerate unknown fields, and isolate parser failures to
Slack. On protocol drift, disable the affected capability, preserve drafts, and use
a public-API fallback only when its semantics and permissions are equivalent.
A timeout after sending is an unknown outcome: reconcile using verified provider
identifiers before retrying. Never retry blindly through the other transport.

### Notifications and parity

Slack cannot be assumed to send pushes to Flow's app bundle. The connector may
translate authorized events into Flow push notifications using Flow's own delivery
infrastructure and connection routing IDs. Deliver only for the authenticated
recipient's eligible conversations and preferences. Scope token registration and
notification deduplication to the Slack connection; do not register Flow's APNs token
as if it were a Slack first-party device. Where exact Slack notification preferences
or read state are unavailable, label the limitation and use explicit Flow notification
settings instead of claiming parity. The aggregate iOS badge limitation still applies.

All client controls use capabilities with supported/limited/unavailable states and
human-readable reasons. The same Slack capability must behave consistently on web,
macOS, and iOS, including the share extension, unless a documented platform constraint
prevents it. Open in Slack targets are derived from the validated provider context.
An unsupported action must never fall through to a Flow server mutation.

### Slack delivery and acceptance

1. Build the OAuth/connector proof of concept and scope manifest; demonstrate two
   separately authenticated Slack teams alongside one Flow server.
2. Complete the protocol notebook and credential/transport feasibility matrix on
   web, macOS, and iOS. Record supported behavior and actual blockers.
3. Implement and fixture-test the shared adapter contract and public baseline.
4. Add verified internal protocol capabilities, reconnect/gap reconciliation, and
   capability degradation. Complete multi-client parity and notification validation.

Acceptance extends the Flow tests with:

- Two Slack teams using the same API origin remain distinct; a renamed workspace
  keeps its identity; Slack and Flow IDs/cache entries never collide.
- OAuth consent returns the expected actual user/team; cancellation, wrong-team
  selection, missing scopes, denied app approval, rotation, and revocation are handled.
- Send as the user, thread replies, edits, deletes, reactions, and files round-trip
  through Slack's official client and all three Flow clients without duplicates.
- Private channels, DMs, guest restrictions, and Slack Connect events never leak
  between grants; membership removal disables access and clears stale private state.
- Duplicated/out-of-order events, disconnect during a send, missing replay windows,
  429s, and protocol schema changes recover or show an accurate degraded state.
- Partial history is visibly partial; Slack retention limits are not represented as
  an empty complete archive. Exact message timestamps survive serialization.
- Cross-device unread state is tested where supported; otherwise its limitation is
  explicit. Push taps and share actions route to the right Slack identity/workspace.
- Disconnect one client without revoking another's grant; remove one Slack team
  without affecting another team or any Flow connection.

Open implementation decisions: connector hosting/ownership, app distribution and
scope approval, proven internal-session acquisition, event coverage, and the precise
Slack capability set for initial release. OAuth and protocol investigation remain
required deliverables regardless of which optional features ship first.

## Current implementation and migration

Observed starting points:

- Web `packages/web/src/lib/api.ts` has one `flow.token`, same-origin fetches,
  and path-only blob/text caches. `packages/web/src/App.tsx` owns one user and
  workspace selection; sign-out clears the shared query cache.
- Native `apps/macos/Sources/Flow/Support/Server.swift` resolves a static backend.
  Its storage suffix already separates some deployments but is not a connection
  registry. `Keychain.swift` uses a static profile-specific account.
- Native `Networking/APIClient.swift` already accepts a base URL internally;
  `App/AppState.swift`, `Database/AppDatabase.swift`, and `Sync/SyncEngine.swift`
  need session ownership audited. Shared sources also serve iOS.
- `Support/PushPayload.swift` routes using workspace/channel/message IDs and
  currently treats the badge as a single server-authoritative total.
- Server `routes/index.ts` contains login/provider and app-link endpoints;
  `gateway/upgrade.ts` routes socket upgrades.

On first upgrade, create a default connection from the current web origin or native
configured server. Migrate the existing token, selected workspace, and identity to
it after validation. Native migration reads the exact legacy profile storage slot;
preserve QA profile isolation. Use a crash-safe, idempotent migration marker and
retain the old state until the new state is committed. Unknown cache ownership is
discarded and refetched, never assigned to another connection. Never copy a token
to additional origins. Older backends remain usable as the existing default;
adding remote Flow backends requires the new discovery/connection contract. Slack
uses its provider-specific identity and authorization flow, not `/v1/client-info`.

## Delivery and acceptance

1. Shared contract and server discovery/CORS/handoff/push changes, preserving
   current clients. Document operator setup and the supported protocol version.
2. Explicit session runtimes and storage isolation; migrate the existing single
   connection without changing ordinary use.
3. Add/manage/switch UI on web, macOS, and iOS; native share/deep-link integration.
4. Multi-server sync, notification routing, failure cases, and parity verification.

Acceptance uses two independent backends with deliberately overlapping user,
workspace, channel, and file IDs, and different credentials/content:

- Both accounts stay signed in across restart; same email never links identities.
- Switching sends every request/socket event to the correct server. Delayed sends,
  uploads, responses, and old-session 401s cannot cross contexts or resurrect state.
- Cached images, drafts, search, unread counts, and navigation remain isolated,
  including two windows/tabs showing different servers.
- Expire, disconnect, sign out, delete an account, and remove membership on A;
  verify B remains usable and its state intact. Reauthenticate A as a different user.
- Exercise each advertised auth method, invite links, canceled and mismatched
  callbacks, replayed codes, and a backend with registration disabled.
- Validate allowed/rejected web origins, preflights, WS origin policy, external
  storage uploads, and no bearer forwarding across origin/port/scheme changes.
- Push and share-extension actions select the correct connection despite duplicate
  IDs; stale pushes after removal are ignored; badge behavior matches this spec.
- Upgrade existing profiles and interrupt migration midway; no lost session or
  credential reassignment. Verify all three clients against a legacy default server.

Product decisions to confirm: one account per Flow server and per Slack team in V1; local-only connection
configuration; all connected servers syncing while the client is running; and the
iOS background badge limitation. These defaults keep the core per-workspace
experience complete without introducing server federation or central identity.
