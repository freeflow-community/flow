# Mini apps: authenticated agent-hosted apps behind link artifacts

Status: **built and deployed**. Written 2026-08-24, shipped 2026-08-26/27
across #369–#374. The Task Board is the first app running behind it.

## Problem

An agent can run a web app on its own machine (the Task Board), expose it
through a public tunnel, and pin the tunnel URL as a link artifact. The
artifact controls who *sees the URL* — channel members — but the tunnel
accepts anyone: hostnames get scanned, URLs leak through screenshots, logs,
and Referer headers. The app's only protection today is URL obscurity, and
it has no idea which Flow user is clicking.

## Design in one paragraph

An "app" link artifact owns a per-artifact **secret**, returned once to the
creating agent. When a channel member opens the artifact, their client asks
the Flow server to **mint a short-lived token** (HMAC-signed with that
secret, carrying the member's identity); the server checks channel
membership at mint time — membership stays enforced where it already
lives. The client opens the tunnel URL with the token attached. A small
**guard** process in front of the app — shipped by the agent bridge —
verifies the token offline, swaps it for its own session cookie, and
proxies requests to the app with identity headers. Unauthenticated traffic
never reaches the app.

```
member's client ── POST /v1/artifacts/:id/app-token ──▶ Flow server
      │  (member? → minted token)                          │
      ▼                                                    │ nothing further —
open  https://tunnel…/?flow_token=…                        │ verification is offline
      ▼
 ┌──────────┐  verify HMAC, set cookie, 302 clean URL
 │  guard   │──── proxy + X-Flow-* headers ───▶ the app (localhost)
 └──────────┘
```

## The token

`flow_token = base64url(payloadJson) + "." + base64url(hmacSha256(secret, payloadJson))`

Payload:

```json
{
  "v": 1,
  "artifactId": "…",
  "channelId": "…",
  "workspaceId": "…",
  "userId": "…",
  "displayName": "Scott",
  "isAgent": false,
  "iat": 1787540000,
  "exp": 1787540300,
  "jti": "one-time-random-id"
}
```

- **exp − iat = 300 s.** The token is a door key, not a session: it exists
  to get one browser through the guard once.
- **jti + single-use:** the guard remembers seen `jti`s until their `exp`
  and rejects replays. The memory is bounded by the 5-minute window.
- **HMAC, not JWT libraries:** one fixed algorithm, no `alg` header to
  attack, verifiable in a few lines in any language. `v` exists so the
  format can evolve.
- The secret never travels after creation. Verification is offline; the
  guard makes no calls to Flow.

## Server

1. **Registering an app.** `POST /v1/artifacts` gains `app: true`
   (valid only with `url`). The row stores kind `link` plus an `appSecret`
   (random 32 bytes, encrypted at rest like message bodies). The create
   **response** carries the secret — once. It is never returned by any
   read endpoint. `ArtifactDTO` gains `isApp: boolean` so clients know to
   mint before opening; the secret is NOT in the DTO.
2. **Minting.** `POST /v1/artifacts/:id/app-token` — caller must be a
   member of the artifact's channel (same gate as every artifact
   operation). Returns `{ token, expiresAt }`. Not rate-limit-sensitive:
   minting is one HMAC.
3. **Rotation.** `POST /v1/artifacts/:id/app-secret` (creator or
   workspace admin) generates a new secret and returns it once —
   outstanding tokens die with the old secret. This is the revocation
   lever beyond kicking members.
4. Membership changes need no plumbing: a removed member fails the next
   mint, and the short cookie session (below) bounds what they keep.

## Guard (agent side, shipped by the bridge)

`npx flow-agent-bridge app-guard --upstream http://localhost:3000 --port 8788`
with the secret in `FLOW_APP_SECRET` (the agent got it from
`create_artifact`). The agent tunnels the **guard's** port, never the
app's.

Behavior:

- Request with valid `?flow_token=` → verify, burn `jti`, set
  `flow_app_session` cookie (HttpOnly; Secure; **SameSite=None** — the web
  client frames the app cross-origin), 302 to the same path without the
  token. Session lifetime **8 h**, held server-side in the guard (an
  in-memory map: cookie value → identity, expiry) so nothing decodable
  lives in the browser.
- Request with valid session → proxy to upstream, adding
  `X-Flow-User-Id`, `X-Flow-User-Name`, `X-Flow-Artifact-Id`,
  `X-Flow-Channel-Id`, `X-Flow-Is-Agent` — and stripping any inbound
  `X-Flow-*` so clients can't spoof identity.
- Anything else → `401` with a one-line HTML page: "Open this app from its
  Flow channel." No redirect loops into Flow — the artifact is the way in.
- WebSocket upgrade requests are proxied with the same cookie check
  (live apps need it; the Task Board already uses polling, but don't
  design it out).

**How the app perceives all this:** it doesn't see tokens, cookies, or the
secret. It sees a reverse proxy that only ever forwards authenticated
requests, each labeled with `X-Flow-*` identity headers. A naive app needs
zero changes; a per-user app reads two headers; an app that wants to skip
the guard entirely can verify tokens itself against the documented format
with the same secret.

## Clients

All three do the same small thing: opening a link artifact with
`isApp: true` first calls the mint endpoint, then loads
`url + (?flow_token=…)`.

- **web** — the co-browsing mini-browser iframe. Mint before setting
  `src`. The URL-bar PATCH co-browse behavior is unchanged (the shared
  artifact URL never includes a token; tokens are appended per viewer at
  load time). Reload = re-mint.
- **macOS** — same, in the artifact panel webview.
- **iOS** — link artifacts open externally today; mint, then hand the
  tokened URL to the system browser.
- Failure mode: mint fails (no longer a member, artifact gone) → the
  standard error surface, no iframe load.

## What this deliberately does not do

- **No Flow-hosted proxy.** Routing app traffic through the Flow server
  (HTTP-over-WebSocket to the agent) would remove the public tunnel
  entirely and is the natural phase 2 — the token/identity contract here
  survives that change unchanged. Not now: it is a transport project, not
  an auth project.
- **No third-party IdP** (Cloudflare Access etc.): identity would not map
  to workspace membership, and IdP redirects break inside the iframe.
- **No long-lived capability URLs:** the artifact URL stays clean and
  shareable; possession of the URL grants nothing.

## Risks and open questions

1. **Safari + `SameSite=None` cookies in the web iframe.** ITP may refuse
   the guard's cookie in a framed context. Spike first. Fallback: for
   framed sessions the guard keeps the session key in the URL path/query
   it controls (it owns every link the app emits is NOT true — so the real
   fallback is re-minting per iframe load, which the web client can do
   invisibly since minting is cheap).
2. **Token-in-URL exposure.** One appearance, ≤5 min validity, single-use,
   immediately stripped by the 302. Tunnel access logs see it after it is
   already burned. Accepted.
3. **Guard state is in-memory.** A guard restart logs everyone out
   (re-mint on next open — invisible in web/macOS). Accepted.
4. **Should `isApp` be creator-agent-only?** Any member can pin a link
   artifact; app registration could stay agent-only (the secret returns
   over the bridge). Leaning: allow any member, return the secret to
   whoever created it — humans can host apps too.
5. **Multiple artifacts, one app?** Re-pinning the same app in a second
   channel means a second artifact and second secret; the guard should
   accept a list of secrets. Config detail, note it in the guard docs.

## Build order

1. Server: `app` flag + secret + mint + rotation, tests. (No client
   visible change yet; ticks no boxes.)
2. Bridge: `create_artifact`/DTO pass-through, `app-guard` subcommand,
   token verification tests, version bump.
3. Clients: mint-before-open, one small PR per surface, Safari spike
   first.
4. Convert the Task Board tunnel to run behind the guard; retire the bare
   tunnel.

All four shipped. What the last step turned up, for whoever converts the
next app:

- **Promotion, not re-pinning.** `create_artifact` on a url already pinned
  as a plain link upgrades that artifact into an app in place and returns
  the secret — same artifact id, same sidebar entry, no second pin for
  members to be confused by. Repointing it at the guard's tunnel is then an
  ordinary `update_artifact`.
- **Order matters:** get the secret first (the promote call), start the
  guard with it, tunnel the guard, repoint the artifact, and only then kill
  the old tunnel. The app is briefly an app pointing at an unguarded url;
  the alternative leaves it pointing at nothing.
- **The app's own view is exactly as designed.** The Task Board needed no
  changes to sit behind the guard, and ~15 lines to read the identity
  headers. Served bare on localhost the headers are simply absent, so
  development doesn't require the guard.
