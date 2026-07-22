# First-class AI Agents (APPROVED — operator rulings 2026-07-20, see end)

Slack-compat apps (APPS.md) gave us bots, but they are second-class: separate
credential universe (xoxb/xapp), separate API surface (/api/*), an outbox with
signatures and retries, and a web-only management modal. This proposal makes AI
agents **first-class workspace members**: real users with an AI badge, invited
like people, speaking the normal /v1 REST + WS protocol — no compat shim.

## Identity model

- `users.is_agent` boolean (new column, default false). Distinct from `is_bot`
  (Slack-compat app bots keep their own lane; nothing merges).
- `UserDTO.isAgent` flows to all clients; render a **small robot emoji (🤖)**
  next to the display name everywhere a name shows (message author line,
  member list, mention autocomplete, DM header). Operator ruling: emoji, not
  a text badge; app bots' existing rendering is untouched.
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
- **Answers in threads**: a top-level *channel* message the agent answers (an
  @-mention, or anything under `eventScope: all`) is answered in a **new
  thread rooted at that message** — the agent's back-and-forth never fills the
  channel's main view. DMs are exempt: the DM already is the conversation.
  Once the agent has spoken in a thread it answers **every** reply there,
  mentioned or not (a thread it's in is a conversation with it); participation
  is resolved from live sessions first, then from the thread itself, so it
  survives a bridge restart.
- **One CLI session per conversation**: the bridge maps
  `(channelId, replyThreadRootId)` → a runtime session, assigned deterministically
  via `--session-id <uuid>` on first message and `--resume` after — each DM or
  thread is a persistent conversation with its own context, and separate
  conversations run **concurrently** (cap N; serialize within a conversation).
  A `/reset` message clears the mapping.
- **The reply contract, baseline**: the CLI's final output text is the reply
  the bridge posts back (`claude -p --output-format json` → `result` field;
  any other CLI → stdout). This is what makes it runtime-agnostic — every
  coding CLI can do "prompt in, text out".
- **Rich mode (v1, per operator ruling)**: pass `--mcp-config` with a tiny
  `flow` MCP server exposing `send_message`, `react`, `upload_file`,
  `search_history` — the agent can then post multiple messages, attach
  files, or react instead of one final reply. Claude and Codex both speak
  MCP; runtimes that don't just fall back to the baseline contract. System
  prompt tells the agent MCP-sent messages deliver immediately and its final
  text is also posted (so keep it short/empty if it already replied).
- **Working directory is the identity**: agent config names a `cwd` (a repo
  checkout). "@RepoBot fix the failing test" runs the CLI *in that repo* with
  its normal tools. This is the compelling use case Channels can't do
  headlessly — the agent is "Claude working in repo X, reachable in chat".
- **Prompt assembly**: `--append-system-prompt` carries the Flow context (you
  are <name>, an agent in workspace <ws>; sender and channel metadata;
  reply conventions; mention format `<@userId>`). The user message body is the
  prompt. Thread context beyond the session's own memory can be fetched from
  /v1 history when joining an existing thread mid-way.
- **Feedback while working (thinking steps — v1, per operator ruling)**:
  typing indicator on spawn, plus the bridge runs the CLI with
  `--output-format stream-json` and surfaces **tool calls** as a live
  "thinking…" step in the chat: on the first tool_use it posts one status
  message (e.g. `🤖 *thinking…* — Bash: pnpm test`) and **edits it in place**
  as each new tool call streams by (latest step shown; keep it one line).
  When the run completes, the status message is deleted and the final reply
  posted fresh (clean unread/notification semantics — no edit-marker on the
  real reply). Config: `progress = thinking (default) | typing | silent`.
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
stream-json parsing for thinking-step status messages; the `flow` MCP server
(send_message, react, upload_file, search_history) shipped in v1. AGENT_MEMBERS.md
integrator doc (APPS.md-style).
[web] 🤖 emoji on agent names; "Invite an Agent" (admin menu, key shown
once); member-list remove/regenerate. [macos] 🤖 emoji parity.
[ios] emoji only (view work, rides phase 7 patterns).
QA: register a scratch agent against the local server, bridge running `claude
-p` in a scratch repo; round-trip DM → working indicator → reply; thread
continuity via --resume; badge render on both clients.

## Operator rulings (2026-07-20)

1. **Badge**: small robot emoji (🤖) next to agent display names — no text
   badge component; app bots' rendering untouched.
2. **Event scope default**: mentions + DMs only; full-channel traffic is a
   per-agent config opt-in.
3. **Agent tokens**: non-expiring until revoked (accepted recommendation).
4. **Invite UI**: web-only admin surface, like Apps.
5. **Progress mode**: tool calls surfaced automatically as a live
   "thinking…" status message (edited in place, deleted on completion) —
   operator upgraded from typing-only; typing indicator also runs.
6. **Reply contract**: MCP rich mode ships in v1 alongside the baseline
   final-text contract.
