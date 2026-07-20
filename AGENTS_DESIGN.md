# First-class AI Agents (PROPOSED design)

Slack-compat apps (APPS.md) gave us bots, but they are second-class: separate
credential universe (xoxb/xapp), separate API surface (/api/*), an outbox with
signatures and retries, and a web-only management modal. This proposal makes AI
agents **first-class workspace members**: real users with an AI badge, invited
like people, speaking the normal /v1 REST + WS protocol — no compat shim.

## Identity model

- `users.is_agent` boolean (new column, default false). Distinct from `is_bot`
  (Slack-compat app bots keep their own lane; nothing merges).
- `UserDTO.isAgent` flows to all clients; render an **AI** badge next to the
  display name everywhere a name shows (message author line, member list,
  mention autocomplete, DM header) — like Slack's APP badge.
- Agents are ordinary members: channels, DMs, group DMs, threads, reactions,
  files, typing, presence (real presence — they hold a live WS) all work with
  **zero special cases**, because nothing downstream branches on the flag.
- Role is always `member`; agents can never be owner/admin, can't invite, and
  can't manage apps/agents. (Server-enforced, not just UI.)

## Invite → register → authenticate

Mirrors the human flow ("Invite an Agent into your workspace") but key-based
instead of email-based:

1. **Invite** (owner/admin): `POST /v1/workspaces/:id/agent-invites
   { nameHint? }` → `agent_invites` row `{ id, workspaceId, tokenHash,
   nameHint, createdBy, expiresAt (default 7d), usedAt, agentUserId }`.
   Returns the raw key once: `flow-agent-<token>`. UI shows it next to the
   server URL as a copy-paste pair (headless consumers need both).
2. **Register** (the agent, unauthenticated): `POST /v1/agents/register
   { inviteKey, name, description?, avatarUrl? }` →
   - consumes the invite (single-use, replay-rejected, expiry-checked — same
     discipline as app-link codes),
   - creates the user row (`is_agent`, unusable password hash, synthetic
     unique email `agent-<id>@agents.flow.local`, emailVerifiedAt stamped —
     same recipe as app bot users),
   - joins the workspace + auto-joins #general (same as invite accept),
   - mints and returns the **agent token** once (raw), stored hashed.
3. **Authenticate**: `agent_tokens` row `{ tokenHash, userId, createdAt,
   lastUsedAt, revokedAt }` — a non-expiring sibling of `sessions` (sessions
   expire; a daemon shouldn't silently die). `authenticate()` checks sessions
   first, then agent tokens. After that the agent is just a bearer-token user
   on /v1 and the WS gateway.

Lifecycle: workspace admins see agents in the member list (AI badge) with
**Remove agent** — reuses today's app-removal semantics (leave workspace +
channels, delete 1:1 DMs, revoke tokens, keep the user row for authorship).
Re-inviting mints a fresh identity. A `regenerate token` action can come later.

## Event bridge: the CLI bridge (primary design)

The bridge is a daemon **we own** (`packages/agent-bridge`, Node, runs
anywhere — laptop, server, Railway) that consumes Flow events and **execs a
coding-agent CLI headlessly per conversation**. It is runtime-agnostic:
Claude Code (`claude -p`), Codex (`codex exec`), or any CLI that fits a
command template.

```
Flow WS ──> agent-bridge daemon ──spawn──> claude -p --resume <sess> "<prompt>"
   ^                                              │ stdout / stream-json
   └──── POST /v1 (reply, typing, react) <────────┘
```

- **Connection**: holds the agent-token WS (real presence — the agent shows
  online while the daemon runs). Subscribes to DMs, @-mentions, and
  (config-optional) full traffic of channels it's a member of.
- **One CLI session per conversation**: the bridge maps
  `(channelId, threadRootId)` → a runtime session, assigned deterministically
  via `--session-id <uuid>` on first message and `--resume` after — each DM or
  thread is a persistent conversation with its own context, and separate
  conversations run **concurrently** (cap N; serialize within a conversation).
  A `/reset` message clears the mapping.
- **The reply contract, baseline**: the CLI's final output text is the reply
  the bridge posts back (`claude -p --output-format json` → `result` field;
  any other CLI → stdout). This is what makes it runtime-agnostic — every
  coding CLI can do "prompt in, text out".
- **Rich mode (optional per runtime)**: pass `--mcp-config` with a tiny
  `flow` MCP server exposing `send_message`, `react`, `upload_file`,
  `search_history` — the agent can then post multiple messages, attach
  files, or react instead of one final reply. Claude and Codex both speak
  MCP; runtimes that don't just stay on the baseline contract.
- **Working directory is the identity**: agent config names a `cwd` (a repo
  checkout). "@RepoBot fix the failing test" runs the CLI *in that repo* with
  its normal tools. This is the compelling use case Channels can't do
  headlessly — the agent is "Claude working in repo X, reachable in chat".
- **Prompt assembly**: `--append-system-prompt` carries the Flow context (you
  are <name>, an agent in workspace <ws>; sender and channel metadata;
  reply conventions; mention format `<@userId>`). The user message body is the
  prompt. Thread context beyond the session's own memory can be fetched from
  /v1 history when joining an existing thread mid-way.
- **Feedback while working**: typing indicator on spawn; with
  `--output-format stream-json` the bridge can post incremental progress for
  long tasks (config: silent | typing-only | progress messages).
- **Safety**: per-agent `--permission-mode` / `--allowedTools` (or the
  runtime's sandbox flags) preconfigured in agent config — headless runs use
  pre-granted permissions, so scope them: e.g. read-only repo answers vs a
  worktree with write+test. Sender gating and self-message loop-guard as
  before (only forward workspace members; never the agent's own messages).
  `--max-turns` + wall-clock timeout as cost/runaway caps.
- **Config** (`agent.toml` or JSON): server URL, agent token, runtime command
  template, cwd, event scope, permission flags, concurrency, progress mode.

Why this beats the Channels approach for Flow (evaluated first, demoted):

| | CLI bridge | Claude Channels |
|---|---|---|
| Runtime | any CLI (Claude, Codex, …) | Claude Code only |
| Availability | stable flags, no gating | research preview, allowlist / `--dangerously-load-development-channels` |
| Concurrency | session per conversation, parallel | one session; busy events batch together |
| Deployment | headless daemon, server-able | needs a live interactive session |
| Permission story | pre-scoped headless permissions | interactive + remote relay (richer) |

What we give up: Channels' interactive-session injection (events landing in
the session you're actively working in) and its native permission relay
(approve tool use from chat). Both are the interactive-companion use case —
worth revisiting as a second consumer later; the server-side design below is
identical either way. A chat-based approval flow ("agent DMs: may I run X?
reply yes/no") can be built *on* the bridge later via the MCP rich mode.

Rejected alternative: piggybacking agents on the Slack-compat surface. It
works today (Bizzybot proves it) but keeps agents second-class — xoxb tokens,
/api dialect, no presence, APP not AI semantics — and drags the outbox along.

## Work plan (rough)

[server] migration (users.is_agent, agent_invites, agent_tokens); invite +
register + revoke endpoints; authenticate() agent-token path; role guard;
remove-agent (generalize deleteApp). ~1 day. (Transport-agnostic — unchanged
whichever bridge consumer we build.)
[bridge] packages/agent-bridge daemon: WS consume + session map + spawn/
collect + reply post; claude runtime template first, codex template stubbed;
baseline contract only (MCP rich mode later). AGENTS.md integrator doc
(APPS.md-style).
[web] AI badge; "Invite an Agent" (admin menu, key shown once); member-list
remove/regenerate. [macos] AI badge; member-list parity per current gaps.
[ios] badge only (view work, rides phase 7 patterns).
QA: register a scratch agent against the local server, bridge running `claude
-p` in a scratch repo; round-trip DM → working indicator → reply; thread
continuity via --resume; badge render on both clients.

## Pre-flight questions (operator)

1. Badge label: "AI" vs "AGENT"? And should app bots' existing rendering
   adopt the same badge component ("APP") while we're in there?
2. Event scope default: mentions+DMs only (recommended), full-channel opt-in
   per agent config?
3. Agent tokens: non-expiring until revoked (recommended, daemon-friendly) or
   expiring with refresh?
4. Does "Invite an Agent" live in the web-only admin surface like apps
   (consistent), or also macOS?
5. Progress mode default while the CLI works: typing-indicator only
   (recommended) or posted progress messages?
6. Baseline-only for v1 (final-text reply), or include the MCP rich-mode
   `flow` server (multi-message, files, reactions) from the start?
