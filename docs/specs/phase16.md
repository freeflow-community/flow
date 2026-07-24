# Google Sign-In + domain self-registration

> **Status: Shipped 2026-07-24** (server + web). Tracks discussion #52 idea 1.
> Built as specced, with three notes: `hasGoogle` on `UserDTO` was implemented
> as the alternative `GET /v1/me/identities` route (§6) so no join is added to
> every user read; the `hd` hardening of §7 is **on by default**
> (`FLOW_GOOGLE_REQUIRE_HD=0` to relax) and enforced when *setting* the domain
> rather than on each enrolling sign-in; and Google's `picture` is fetched
> through the normal avatar pipeline instead of stored as a foreign URL, because
> clients fetch `avatarUrl` with a bearer header. §9 option 1 (the browser
> handoff) shipped for macOS + iOS in the same phase — the native button opens
> `/?native=google`, which signs in and returns via `flow://signin?code=…`.
> §9 option 2 (a native SDK with its own OAuth client in the `aud` set) remains
> unbuilt, recorded as a deliberate divergence rather than a gap.

Let people register and sign in to Flow with Google, and let a workspace owner
open the doors to everyone on their email domain: when the toggle is on, any
Google user whose *verified* email matches the domain self-registers straight
into the workspace — no per-person invite.

## Scope

- **Server:** verify a Google ID token, resolve it to a Flow user (link by
  verified email, create on first sight), issue a normal session. A new
  `oauth_identities` table records the provider↔user binding. A workspace gains
  an optional `google_self_register_domain`; matching Google sign-ins auto-enroll.
  `[server]`
- **Web:** a "Continue with Google" button on the auth screen (sign-in *and*
  register share one button — Google has no separate "register"), and, in the
  create-workspace step, a toggle offered only when the creator authenticated
  with Google: *"Allow anyone with an @domain email to join this workspace."*
  `[web]`
- **Parity:** native macOS/iOS Google sign-in is a **gap to close**, not shipped
  in this phase — see §9. The domain-self-register *result* (auto-enrollment)
  works for native users too, because it keys off the account, not the client.

Out of scope: other IdPs (Microsoft/Okta/SAML), Google Workspace directory sync
/ SCIM, org-verified domain ownership (we trust Google's `email_verified` +
`hd`, we do **not** prove the workspace owner controls the domain — see §7),
and de-linking a Google identity in settings (follow-up).

---

## 1. Background — what exists today

Auth is email-first and password-based (`services/auth.ts`):

- `users.email` is `citext unique`; `users.password_hash` is **`text NOT NULL`**;
  `email_verified_at` gates password login.
- Register emails a signup link → `register/complete` sets name + password.
  Also: password login, password-reset links, passwordless sign-in links, and a
  web→native handoff (`/v1/auth/app-link` mints a one-time code the app
  exchanges via `flow://signin?code=`).
- Sessions are bearer tokens with a sliding 30-day expiry (`authenticate()`).
- **Bots and agents already model "a user with no usable password":** they get a
  synthetic email and a sentinel hash (`!agent:<random>` / `!bot:…`) so the
  `NOT NULL` column stays satisfied and `argon2.verify` always fails. Google-only
  users reuse exactly this trick (§3) — no schema change to `password_hash`.

Workspace membership (`services/workspaces.ts`): you become a member by
**creating** a workspace (owner), **accepting an invite** (`invites` table,
per-email), or **redeeming an agent invite** (phase 15). Each path inserts a
`workspace_members` row, adds you to `#general`, and emits `member.joined`. This
phase adds a fourth path — **domain self-registration** — that reuses the same
join primitive.

Relevant seams to reuse, not reinvent:
- `issueSession(userId, clientInfo)` → session token. Google sign-in ends here.
- `toUserDTO(user)` → the `AuthResponse.user` shape, unchanged.
- The `acceptInvite` transaction body (member row + `#general` + `member.joined`)
  is the exact shape auto-enroll needs; factor the common part into a helper
  `enrollInWorkspace(tx, workspaceId, userId, role='member')` and call it from
  both.

---

## 2. Google verification

Client obtains a Google **ID token** (a signed JWT) via Google Identity Services
and posts it to us. The server never sees the user's Google password; we only
validate the token.

- Add `google-auth-library` and verify with `OAuth2Client.verifyIdToken({
  idToken, audience: config.googleClientId })`. This checks the signature against
  Google's rotating JWKS, `iss ∈ {accounts.google.com, https://accounts.google.com}`,
  `aud === our client id`, and `exp`. Do **not** hand-roll JWT verification.
- From the verified payload take: `sub` (Google's stable user id — the join key),
  `email`, `email_verified`, `name`, `picture`, and `hd` (hosted-domain, present
  only for Google Workspace accounts).
- **Reject `email_verified !== true`** with `403 email_unverified`. An unverified
  Google email cannot be trusted to link to or create a Flow account, and must
  never satisfy the domain-self-register rule.
- One Google Cloud OAuth **Web client** serves web now and is the `aud` native
  will target later (§9). Config (env, no secrets in repo):

  | Variable | Meaning |
  |---|---|
  | `GOOGLE_CLIENT_ID` | OAuth 2.0 Web client id — also the token `aud` |
  | `GOOGLE_CLIENT_SECRET` | only if we adopt the auth-code flow (§8); unused for the ID-token flow |

  Expose `config.googleClientId` and a `config.googleEnabled` getter (`true` when
  the client id is set). When disabled, the Google endpoint returns
  `503 google_disabled` and clients hide the button (they read it from
  `/v1/config`, or infer from a 503 — see §5/§6).

---

## 3. Data model

**New — `oauth_identities`** (`0023_oauth_identities.sql`): one row per external
identity linked to a Flow user. Provider-agnostic so Microsoft/etc. slot in later.

```
oauth_identities
  provider          text        not null           -- 'google'
  provider_subject  text        not null           -- Google `sub`
  user_id           uuid        not null → users.id on delete cascade
  email             citext      not null           -- verified email at last sign-in
  created_at        timestamptz not null default now()
  primary key (provider, provider_subject)
  index on (user_id)
```

Match order on sign-in: **`(provider, sub)` first** (a returning user, robust to
email changes), then fall back to **verified email → existing `users` row** (a
password user adding Google, or an invited-by-email user's first Google sign-in),
else **create**. `sub` is the durable key; email is stored for display/audit and
refreshed on each sign-in.

**Changed — `workspaces`** (same migration): add

```
google_self_register_domain  citext   -- null = off; e.g. 'acme.com'
```

`null` means the feature is off for that workspace (the default). A non-null
value is the lowercased email domain that may self-enroll. `citext` so matching
is case-insensitive. No change to `password_hash` (§1).

**`users` for a Google-first account:** real verified `email` (from Google),
`display_name` from `name`, `email_verified_at = now()`, `password_hash =
'!google:<random>'` (unusable — mirrors `!agent:`). `avatar_url` seeded from
Google `picture` **only when the user has none** (never overwrite a chosen one).

---

## 4. Server: sign-in service + endpoint

`services/oauthGoogle.ts`, one entry point:

```
signInWithGoogle(idToken: string, clientInfo?: string): Promise<AuthResponse & { autoJoined: WorkspaceDTO[] }>
```

1. Verify the token (§2). Reject unverified email.
2. Resolve the user (§3 match order). On create, insert the `users` row and the
   `oauth_identities` row in one transaction; on link, insert only the identity
   row (guard the email→user link with `email_verified === true`, already
   enforced). Refresh `oauth_identities.email` + backfill a missing avatar.
3. **Domain self-registration:** let `domain = lower(email.split('@')[1])`.
   Select workspaces where `google_self_register_domain = domain` and the user is
   not already a member; `enrollInWorkspace()` each (member row + `#general` +
   `member.joined`), collect their DTOs. Best-effort per workspace — one failure
   doesn't sink the sign-in. (Optionally require Google `hd === domain` for extra
   assurance on Workspace accounts; see §7.)
4. `issueSession` and return `{ token, user, autoJoined }`.

**Account-collision rule:** if the verified email matches an existing user that
is a **bot or agent** (`is_bot`/`is_agent`), refuse — never merge a human Google
login into a service account. Return `409 email_reserved`.

Endpoint (open, like login):

```
POST /v1/auth/google        { idToken }        → 201 { token, user, autoJoined }
```

Add `GoogleAuthBody = z.object({ idToken: z.string().min(1).max(4096) })`. Rate-
limit by IP the same way login is (token verification is a network call to
Google's JWKS cache — cache the certs, which the library does).

`autoJoined` lets the client show *"You've joined 2 workspaces on your
domain"* and route straight in instead of the empty create-workspace screen.
`AuthResponse` itself is unchanged; the extra field rides on the Google response
type only.

---

## 5. Web: sign in with Google

- Load Google Identity Services (`https://accounts.google.com/gsi/client`).
  Render the button (or a styled custom button calling `google.accounts.id`) on
  the `signin` **and** `register` panels of `AuthScreen.tsx` — with Google the
  two are the same operation, so one button under the "or" divider that already
  hosts "Email me a sign-in link".
- On credential callback, `POST /v1/auth/google { idToken }`, then `onSignedIn`.
  If `autoJoined.length`, surface a toast and skip create-workspace.
- Hide the button when Google is disabled server-side. Add `google: boolean` to
  a small public `GET /v1/config` (or reuse an existing bootstrap payload) so the
  client knows without a failed round-trip.
- **Pending invite interplay:** if `localStorage['flow.pendingInvite']` is set,
  after Google sign-in accept it (existing `acceptInvite` path) *in addition to*
  any domain auto-joins. Google sign-in must satisfy the invite banner the same
  way email register does today.

## 5a. Web: the domain toggle at workspace creation

In the create-workspace form, when the signed-in user authenticated with Google
(their session user has a linked Google identity — expose `hasGoogle` on
`UserDTO`, or infer from a `GET /v1/me/identities`), show:

> ☐ Let anyone with an **@acme.com** email join this workspace automatically

Checking it sends `googleSelfRegisterDomain: "acme.com"` (the creator's own
email domain — not free-text; we only ever offer *their* domain) to workspace
create/update. Server stores it on the row. Owners/admins can toggle it later in
workspace settings via `PATCH /v1/workspaces/:id`
(`{ googleSelfRegisterDomain: string | null }`), guarded to owner/admin and
validated to equal the setter's own verified email domain (§7). **Never offer
this for public/consumer domains** — reject a denylist (`gmail.com`,
`outlook.com`, `yahoo.com`, `hotmail.com`, `icloud.com`, …); "anyone with a
gmail" is the whole internet.

---

## 6. Clients — types & wiring

- `packages/shared`: `GoogleAuthBody` schema; `GoogleAuthResponse = AuthResponse
  & { autoJoined: WorkspaceDTO[] }`; add `googleSelfRegisterDomain?: string | null`
  to the workspace create/update bodies and `WorkspaceDTO`; add `hasGoogle:
  boolean` (or the `/identities` route) so the toggle knows when to show.
- The domain-self-register **outcome** already reaches every client for free: a
  new member arriving via auto-enroll is an ordinary `member.joined` event and a
  `workspace.joined` for the joining user's own sockets — no client change to
  *receive* it.

---

## 7. Security & trust boundaries

- **We trust Google's `email_verified`, not domain ownership.** The toggle keys
  off the *setter's own* verified email domain, so enabling `acme.com` requires
  someone who already holds an `@acme.com` Google account that Google says is
  verified. That is the trust anchor — we do not (this phase) do DNS/TXT domain
  verification. Document this in `decision_log.md`: the risk is a rogue employee
  opening their own company's workspace to all colleagues, not a stranger
  opening someone else's domain.
- **Consumer-domain denylist is mandatory** (§5a) — without it the toggle is an
  open-registration hole.
- **`hd` hardening (optional, recommended):** for the toggle, prefer requiring
  the Google payload's `hd` (hosted domain) to equal the domain, which limits it
  to real Google Workspace orgs and blocks a personal gmail that merely *spells*
  a corporate address. If we don't require `hd`, at minimum the denylist stands.
- **No account pre-hijacking:** linking by email is gated on `email_verified ===
  true` from Google, so an attacker can't create `victim@corp.com` in Flow by
  asserting an unverified Google email.
- **Bot/agent emails are off-limits** to Google linking (§4 collision rule).
- **Session parity:** a Google sign-in yields the same session type as any other
  login; `logout`, sliding expiry, and revocation are unchanged.

---

## 8. ID-token vs auth-code flow

We use the **ID-token** flow (GIS returns a signed JWT straight to the browser;
server verifies statelessly). It needs no client secret and no server-side token
exchange — the least surface for "sign in and get a Flow session." The
**auth-code** flow (needs `GOOGLE_CLIENT_SECRET`, a redirect URI, and a
server-side exchange) is only worth it if we later need Google **refresh tokens**
to call Google APIs on the user's behalf (calendar, directory). We don't here, so
ID-token it is; §2's config leaves room to add the secret later without a
redesign.

---

## 9. Native parity (gap to close)

macOS/iOS today lean on the web for the email-first flow and a `flow://signin`
handoff. Two ways to bring Google to native, later:

1. **Reuse the handoff (cheap, ship first):** native "Continue with Google"
   opens the system browser to a Flow web page that runs GIS, calls
   `/v1/auth/google`, then mints an app-link code and redirects to
   `flow://signin?code=…`. Zero new native crypto; one small web page. This is
   the recommended first step and mirrors how native already borrows the web
   email flow.
2. **Native SDK (later):** `ASWebAuthenticationSession` / Google Sign-In SDK to
   get an ID token in-app and post it to `/v1/auth/google` directly. Needs an
   iOS/macOS OAuth client id added to `aud` acceptance (§2 verify accepts a set).

Until (1) ships, native users **register/sign in by email as today** but still
**benefit from domain self-registration** — the auto-enroll fires on their next
sign-in regardless of client, because it's account-scoped. Track this in the
CHANGELOG **Parity** section as a deliberate, temporary divergence.

---

## 10. Testing

- **Unit:** token verification wrapper with a mocked `verifyIdToken` — verified
  email creates+links; unverified email → 403; `sub` match beats email match;
  bot/agent email collision → 409.
- **Domain enroll:** user signs in with `x@acme.com`; a workspace with
  `google_self_register_domain='acme.com'` gains the member + `#general` +
  emits `member.joined`; a non-matching workspace does not; already-a-member is a
  no-op (no duplicate `member.joined`).
- **Denylist:** `PATCH` setting `gmail.com` is rejected.
- **Toggle authz:** non-owner/admin cannot set the domain; setting a domain ≠
  your own verified email domain is rejected.
- **Web e2e (Playwright with a stubbed GIS credential):** button appears only
  when enabled; sign-in lands in-app; create-workspace shows the toggle only for
  Google sessions; auto-join toast on domain match.

---

## 11. Acceptance

- A brand-new Google user clicks "Continue with Google" on web and lands in Flow
  with a session and a Flow user (verified email, avatar from Google, no
  password) — no email round-trip.
- An existing password user who clicks Google with the same verified email is
  **linked** (one `users` row, a new `oauth_identities` row), not duplicated.
- A workspace owner with an `@acme.com` Google account enables the toggle; a
  different `@acme.com` Google user signing in for the first time is
  automatically a member of that workspace and sees `#general`, with a
  `member.joined` notice — **without an invite**.
- `gmail.com` (and the rest of the consumer denylist) cannot be set as a
  self-register domain.
- Unverified Google email, and bot/agent email collisions, are refused.
- With `GOOGLE_CLIENT_ID` unset the button is hidden and `/v1/auth/google`
  returns `503 google_disabled` — nothing else regresses.
- CHANGELOG gets `[server]` + `[web]` entries and a **Parity** line for the
  native Google-button gap (§9); FEATURES.md gets a user-facing line
  ("Sign in with Google; open a workspace to everyone on your company domain").
  `decision_log.md` records the trust-boundary ruling (§7).
