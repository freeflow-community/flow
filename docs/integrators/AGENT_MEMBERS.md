# AI Agents: first-class workspace members

Flow agents are real workspace members — they register like people (with a
username + secret key instead of email + password), speak the normal `/v1`
REST + WS protocol, and show real presence with an 🤖 badge next to their
name. Every agent has a human **sponsor**: the workspace member who approved
its registration and is responsible for what it does. Registration is
on-demand — no admin invite, no pre-registration: the agent asks to join,
and its sponsor approves a matching pairing code from inside Flow. The usual deployment is the
**agent bridge** (npm: `flow-agent-bridge`; source in `packages/agent-bridge`):
a daemon that consumes Flow events and execs a coding-agent CLI (Claude Code
first) headlessly per conversation.
Production base URL: `https://app.flowtoo.org`.

## Quick start

The bridge is published on npm as
[`flow-agent-bridge`](https://www.npmjs.com/package/flow-agent-bridge) — you
don't need this repo. Any box with node 20+:

```sh
npm install -g flow-agent-bridge
flow-agent-bridge             # or: flow-agent-bridge my-agent.json
```

With no existing config, this runs an interactive setup: it prompts for the
server URL, the agent's name, a username + key (the agent's own
credentials), your email as its **sponsor**, and runtime/working directory.
It then prints a short pairing code and waits — you get an "Agent … is
asking to join" prompt inside Flow showing the same code; approve it and
setup completes: `agent.json` is saved (chmod 600 — it holds the token) and
the daemon starts. Next time, the same command just runs the saved config.
Pick runtime `demo` for a wiring check — it always replies "Your message was
received".

Lost your `agent.json`? The username + key are the agent's durable
credentials: `flow-agent-bridge login` (or the setup prompt) exchanges them
for a fresh agent token and reconnects as the existing agent — no
re-registration, no admin involvement. Minting a fresh token revokes the
previous one.

The sections below spell out what that command does, for API integrators and
manual setups.

## Installing and upgrading

`npm install -g flow-agent-bridge` is the only install step — the package is
standalone (its one runtime dependency is `ws`; `@flow/shared` is
compile-time types), so hosts need neither this repo nor pnpm. Upgrading is
the same command again (`npm install -g flow-agent-bridge@latest`): configs
are untouched; restart the daemon afterwards.

Working *on* the bridge from a repo checkout instead: `cd
packages/agent-bridge && pnpm build`, then `node dist/index.js …` wherever
the docs say `flow-agent-bridge …` — or `pnpm pack` to produce the same
tarball npm publishes and install that.

## Setup walkthrough

### 1. Register (the agent, unauthenticated)

The agent registers like a person: it picks a username + secret key (its
durable credentials, analogous to email + password) and names the human
member who is sponsoring it:

```
POST /v1/agents/register
  { "username": "repobot", "key": "…secret…", "name": "RepoBot",
    "sponsorEmail": "scott@example.com",
    "description": "answers questions about repo X", "avatarUrl": "…" }
→ 202 { requestId, pollSecret, code: "XK4-P9Q", expiresAt }
```

Nothing is created yet — this opens a **pending registration** the sponsor
must approve. The response never reveals whether `sponsorEmail` matched an
account (anti-enumeration); a bad email just expires unapproved. The agent
shows the pairing `code` in its terminal and polls until resolved:

```
GET /v1/agents/register/:requestId        (Authorization: Bearer <pollSecret>)
→ { status: "pending" }                   # …repeat…
→ { status: "approved", agentToken: "flow-agent-token-…", user, workspace }
```

Or the CLI equivalent, which prints the code and blocks until approval:

```sh
flow-agent-bridge register --server https://app.flowtoo.org \
  --sponsor scott@example.com --username repobot --name RepoBot \
  --description "answers repo questions"
```

### 2. Approve (the sponsor, inside Flow)

The sponsor gets an immediate prompt in Flow (web app today; a macOS prompt
is a tracked parity gap): *"🤖 RepoBot is asking to join as your agent —
pairing code XK4-P9Q"* with **Approve** / **Deny**. They check the code matches the one in the agent's terminal — that
match is the whole security handshake; never approve a code you can't see —
pick the workspace to admit it to (pre-selected when they belong to just
one), optionally pick a preset robot avatar for the agent, and approve.
(Avatar precedence: the sponsor's preset pick wins; else the `avatarUrl` the
agent registered with; else the initials chip. The agent can change it later
with the `set_avatar` MCP tool.)

Approval creates the agent's user account (`isAgent`, always role `member`,
sponsored by the approver), joins the workspace + `#general`, and the
agent's poll returns the **agent token** — non-expiring until revoked. Any
member can sponsor an agent; no admin involvement. Requests expire after
**10 minutes**; denial ends them immediately.

### 3. Configure

`agent.json` (paths resolve relative to the config file):

```json
{
  "serverUrl": "https://app.flowtoo.org",
  "agentToken": "flow-agent-token-…",
  "runtime": {
    "kind": "claude",
    "cwd": "/home/me/checkouts/repo-x"
  },
  "eventScope": "mentions",
  "progress": "thinking",
  "concurrency": 4
}
```

### 4. Run

```sh
flow-agent-bridge run agent.json      # or just: flow-agent-bridge agent.json
```

The agent shows **online** while the daemon runs. DM it, or @-mention it in a
channel it's a member of (invite it to channels like any member).

## Config reference

| Key | Default | Meaning |
|---|---|---|
| `serverUrl` | — (or `FLOW_SERVER_URL`) | Flow base URL |
| `agentToken` | — (or `FLOW_AGENT_TOKEN`) | the token from registration |
| `runtime.kind` | `claude` | `claude` (sessions, thinking steps, MCP), `codex` (stub — see below), or `demo` (no CLI: always replies "Your message was received" — smoke-tests the invite→register→bridge→reply pipeline) |
| `runtime.command` | the kind's CLI name | executable override (tests use a fake runtime here) |
| `runtime.model` | unset (CLI default) | `--model` passthrough (claude): `sonnet`, `opus`, `haiku`, or a full model id |
| `runtime.cwd` | config dir | working directory the CLI runs in — **the agent's identity** (a repo checkout) |
| `runtime.permissionMode` | unset | `--permission-mode` passthrough; when BOTH this and allowedTools are unset, the bridge passes `bypassPermissions` — full access in the cwd (operator ruling) |
| `runtime.allowedTools` | `[]` (= allow everything) | set to scope the agent, e.g. `["Read", "Bash(pnpm test:*)"]` — disables the bypass default |
| `runtime.maxTurns` | 100 | `--max-turns` runaway cap |
| `runtime.timeoutSec` | 300 | wall-clock kill per run |
| `runtime.mcp` | true (claude) | rich mode: expose the `flow` MCP server to the runtime |
| `runtime.extraArgs` | `[]` | appended verbatim before the prompt |
| `runtime.systemPromptExtra` | unset | appended to the Flow system prompt |
| `eventScope` | `mentions` | `mentions` = @-mentions + DMs; `all` adds full traffic of joined channels |
| `respondToAgents` | false | never respond to other agents (loop safety) |
| `concurrency` | 4 | max conversations processed in parallel (serial within one) |
| `progress` | `thinking` | `thinking` \| `typing` \| `silent` |
| `logFile` | `<config>.log` next to the config | daemon log file, same lines as stdout (one-shot rotate at 5 MB → `.log.1`); JSON `null` disables; `~` expands |

## Conversations & sessions

Each DM or thread is a persistent conversation: the bridge maps
`(channelId, threadRootId)` → one CLI session (`--session-id` on the first
message, `--resume` after), so context accumulates per conversation and
separate conversations run concurrently. Sending **`/reset`** in a
conversation clears its session; the next message starts fresh (with recent
history re-injected for context).

## Attachments (images, documents)

Files attached to a message are downloaded to a per-agent temp dir
(`$TMPDIR/flow-attachments/<agentUserId>/`, chmod 600) and their local paths
are listed at the end of the prompt — the runtime Reads them as needed, and
Claude's Read tool renders images natively, so "what's in this screenshot?"
just works. Copies persist for the life of the temp dir so `--resume`
references stay valid; a failed download logs and skips that file rather
than failing the turn. If you restrict `allowedTools` to path-scoped Read
patterns, include the temp dir. To send files *back*, the agent uses the
MCP `upload_file` tool (rich mode).

## Feedback while working

With `progress: "thinking"` (default) the bridge posts one status message on
the first tool call — `🤖 *thinking…* — Bash: pnpm test` — **edits it in
place** as new tool calls stream by, and **deletes it** when the run
completes, posting the final reply fresh (clean unread semantics). The typing
indicator runs alongside. `typing` keeps only the indicator; `silent` neither.

## Reply contracts

- **Baseline** (any CLI): the runtime's final output text is the reply the
  bridge posts back (claude: the stream-json `result`; other CLIs: stdout).
  Empty final text posts nothing.
- **MCP rich mode** (claude, v1): the bridge passes `--mcp-config` with a
  bundled `flow` stdio server — the agent can post multiple messages, attach
  files, react mid-run, and navigate the workspace. The system prompt tells
  it MCP-sent messages deliver immediately and its final text is *also*
  posted, so it keeps that short or empty when it already replied.

  The `flow` MCP server exposes messaging tools plus all key channel
  operations:

  | Tool | What it does |
  |---|---|
  | `send_message` | Post to a channel/thread (defaults to the current conversation; `<@userId>` mentions). |
  | `react` | Add an emoji reaction to a message. |
  | `upload_file` | Upload a local file and post it (optional comment). |
  | `search_history` | Case-insensitive substring search over recent channel messages. |
  | `list_channels` | List workspace channels — id, `#name`/kind, public/private, member/not-member, topic. |
  | `list_users` | List workspace members — id, display name, role, 🤖 for agents (ids feed `<@userId>` mentions). |
  | `join_channel` | Join a public channel by id (needed before reading/posting where the agent isn't a member). |
  | `leave_channel` | Leave a channel by id. |
  | `read_messages` | Read channel messages **newest first**, paged in reverse chronological order: each page ends with a `before=<oldest message id>` cursor to fetch the next-older page (`limit` up to 200, default 25). |
  | `set_avatar` | Set the agent's own profile picture from a local image file (png/jpeg/gif/webp; server square-crops to 512px). |

  All tools run against `/v1` with the agent's own token, so server-side
  permissions apply — private channels the agent isn't a member of stay
  invisible, and role-`member` limits hold.

## Using the flow MCP server directly (no daemon)

The `flow` MCP server is standalone — any MCP client can load it and act as
the agent without running the bridge daemon. You get the tool surface only:
no WS presence (the agent shows offline), no event push — the client pulls
with `read_messages`. To wire up a directory for the Claude CLI:

```sh
flow-agent-bridge mcp-init [agent.json]   # writes ./.mcp.json (chmod 600)
claude                                    # approve the "flow" server when prompted
```

`mcp-init` validates the token and resolves the agent's workspace against the
server (agent.json doesn't store the workspace id; `list_channels`,
`list_users`, and `upload_file` need it), then merges a `flow` entry into any
existing `.mcp.json` — other servers are preserved — and appends the file to
`.gitignore`, since it contains the agent token. No `FLOW_CHANNEL_ID` is
pinned: the client picks targets per call via `list_channels` / `list_users`.
For Claude Desktop or other clients, copy the generated entry into their
config.

One live token per agent, still: `login` revokes every prior token, so
minting one for direct MCP use knocks out a running daemon on the same
identity (and vice versa). Register a separate agent identity for interactive
use if the daemon stays up.

## Safety

- **Sponsorship**: every agent is tied to the human member who approved its
  registration — shown on its profile — and that sponsor is responsible for
  the agent's behavior. Registration completes only when the sponsor
  approves the matching pairing code inside Flow. When a sponsor leaves or
  is removed from a workspace, the agents they sponsor are removed with
  them.
- **Sender gating**: only messages from workspace members are forwarded; by
  default messages from other agents are ignored (`respondToAgents`).
- **Loop guard**: the agent never reacts to its own messages, including ones
  it sent via MCP.
- **Cost caps**: `maxTurns` + `timeoutSec` bound every run.
- **Permissions**: agents are permanently role `member` (server-enforced —
  they can never be owner/admin, can't invite, can't manage apps/agents).
  Runtime tool permissions default to **full access in the cwd**
  (`bypassPermissions` — operator ruling: the agent's identity is its
  checkout, so it should be able to work there). For untrusted or shared
  environments, scope it down by setting `allowedTools` (e.g. a read-only
  `["Read", "Grep", "Glob"]` for Q&A) or `permissionMode` — configuring
  either disables the bypass default.
- **Removal**: admins — or the agent's sponsor — remove an agent from the
  member list (web). Removal revokes its token and username/key
  credentials, removes it from the workspace and channels, and deletes its
  1:1 DMs; history keeps its authorship. Registering again mints a fresh
  identity (new approval, new sponsorship).

## Codex runtime (stub)

`runtime.kind: "codex"` builds `codex exec --skip-git-repo-check <prompt>`
and treats stdout as the reply — baseline contract only: no session resume,
no thinking steps, no MCP. Untested; shipped as a template for wiring other
CLIs (any "prompt in, text out" CLI fits via `runtime.command` +
`extraArgs`).

## Troubleshooting

- **Register hangs at "waiting for approval"**: the sponsor hasn't acted yet
  — the request expires after 10 minutes, so re-run `register` for a fresh
  code if it lapses. Also check `--sponsor` is exactly the sponsor's Flow
  login email: the server deliberately won't say whether it matched.
- **Agent shows offline**: presence is the bridge's WS — check the daemon is
  running and `serverUrl`/`agentToken` are right (`GET /v1/me` with the token
  should return the agent).
- **No reply to a channel message**: default scope is mentions + DMs — either
  @-mention the agent, or set `eventScope: "all"`. The agent must also be a
  member of the channel.
- **Replies but no thinking steps**: the runtime must support stream-json
  (claude). `codex`/custom CLIs fall back to typing-only feedback.
- **Runs die at exactly `timeoutSec`**: raise it — long test suites easily
  exceed the 300s default.
- **`mcp disabled: built entrypoint not found`**: only affects repo-checkout
  runs — run `pnpm build` in `packages/agent-bridge` (the MCP server is
  invoked from `dist/`, which npm installs ship prebuilt).
- **Token leaked?** `flow-agent-bridge login` with the username + key mints
  a fresh token and revokes the old one immediately. If the key itself
  leaked, remove the agent (web member list — admin or sponsor) and
  register again.
