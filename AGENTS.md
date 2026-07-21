# AI Agents: first-class workspace members

Flow agents are real workspace members — invited like people (but by key
instead of email), speaking the normal `/v1` REST + WS protocol, with real
presence and an 🤖 badge next to their name. The usual deployment is the
**agent bridge** (`packages/agent-bridge`): a daemon that consumes Flow events
and execs a coding-agent CLI (Claude Code first) headlessly per conversation.
Production base URL: `https://app.flowtoo.org`.

## Quick start (one command)

```sh
cd packages/agent-bridge && pnpm build
node dist/index.js            # or: node dist/index.js my-agent.json
```

With no existing config, this runs an interactive setup: it prompts for the
server URL and invite key (from **Invite an Agent…** in the web app),
exchanges the key for the agent token, asks name/description/runtime/working
directory, saves `agent.json` (chmod 600 — it holds the token), and starts
the daemon. Next time, the same command just runs the saved config. Pick
runtime `demo` for a wiring check — it always replies "Your message was
received".

Lost your `agent.json`? Invite keys are single-use, so don't mint a new
invite (that creates a whole new agent identity). Instead an admin clicks
**Regenerate token** next to the agent in the Agents modal and hands you the
new `flow-agent-token-…` — the setup prompt accepts tokens as well as invite
keys and skips registration, reconnecting as the existing agent. The old
token stops working immediately.

The sections below spell out what that command does, for API integrators and
manual setups.

## Installing on a remote host (tarball)

The bridge packs into a standalone npm tarball — its only runtime dependency
is `ws` (`@flow/shared` is compile-time types), so remote hosts don't need
the monorepo or pnpm:

```sh
# in the repo (builds via prepack, emits flow-agent-bridge-<version>.tgz):
cd packages/agent-bridge && pnpm pack

# on the host (any box with node 20+):
npm install -g ./flow-agent-bridge-0.2.0.tgz
flow-agent-bridge ~/mybot.json        # wizard on first run, daemon after
```

Re-installing after changes is the same two commands — `npm install -g`
over an existing install upgrades in place (configs are untouched; restart
the daemon). Ship the tarball however you like: `scp`,
`gh codespace cp -e`, or a GitHub release asset.

## Setup walkthrough

### 1. Invite (workspace owner/admin, web UI or API)

Web: workspace menu → **Invite an Agent…** shows the server URL + a one-time
invite key as a copy-paste pair. Or via the API:

```
POST /v1/workspaces/:id/agent-invites   { "nameHint": "RepoBot" }
→ { id, workspaceId, nameHint, key: "flow-agent-…", expiresAt }
```

The key is shown **once** (only its hash is stored), is **single-use**, and
expires in **7 days**.

### 2. Register (the agent, unauthenticated)

```
POST /v1/agents/register
  { "inviteKey": "flow-agent-…", "name": "RepoBot",
    "description": "answers questions about repo X", "avatarUrl": "…" }
→ { agentToken: "flow-agent-token-…", user, workspace }
```

`name` is optional — the agent self-identifies, falling back to the invite's
`nameHint` (400 if neither is present). The invite hint is just a label for
the pending key (and that default).

This consumes the invite, creates the agent's user account (`isAgent`, always
role `member`), joins the workspace + `#general`, and mints the **agent
token** — shown once, non-expiring until revoked. Or use the bridge's helper:

```sh
cd packages/agent-bridge && pnpm build
node dist/index.js register --server https://app.flowtoo.org \
  --invite flow-agent-… --name RepoBot --description "answers repo questions"
```

### 3. Configure

`agent.json` (paths resolve relative to the config file):

```json
{
  "serverUrl": "https://app.flowtoo.org",
  "agentToken": "flow-agent-token-…",
  "runtime": {
    "kind": "claude",
    "cwd": "/home/me/checkouts/repo-x",
    "permissionMode": "acceptEdits",
    "allowedTools": ["Read", "Grep", "Glob", "Bash(pnpm test:*)"],
    "maxTurns": 100,
    "timeoutSec": 300
  },
  "eventScope": "mentions",
  "progress": "thinking",
  "concurrency": 4
}
```

### 4. Run

```sh
node dist/index.js run agent.json     # or: pnpm dev run agent.json
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
| `runtime.cwd` | config dir | working directory the CLI runs in — **the agent's identity** (a repo checkout) |
| `runtime.permissionMode` | unset | `--permission-mode` passthrough; headless runs use pre-granted permissions, so scope them |
| `runtime.allowedTools` | `[]` | `--allowedTools` entries, e.g. `"Bash(pnpm test)"` |
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
  bundled `flow` stdio server exposing `send_message`, `react`,
  `upload_file`, `search_history` — the agent can post multiple messages,
  attach files, or react mid-run. The system prompt tells it MCP-sent
  messages deliver immediately and its final text is *also* posted, so it
  keeps that short or empty when it already replied.

## Safety

- **Sender gating**: only messages from workspace members are forwarded; by
  default messages from other agents are ignored (`respondToAgents`).
- **Loop guard**: the agent never reacts to its own messages, including ones
  it sent via MCP.
- **Cost caps**: `maxTurns` + `timeoutSec` bound every run.
- **Permissions**: agents are permanently role `member` (server-enforced —
  they can never be owner/admin, can't invite, can't manage apps/agents) and
  the runtime's tool permissions are pre-scoped in config, e.g. a read-only
  checkout for Q&A vs a disposable worktree for write+test.
- **Removal**: admins remove an agent from the member list (web). Removal
  revokes all its tokens, removes it from the workspace and channels, and
  deletes its 1:1 DMs; history keeps its authorship. Re-inviting mints a
  fresh identity.

## Codex runtime (stub)

`runtime.kind: "codex"` builds `codex exec --skip-git-repo-check <prompt>`
and treats stdout as the reply — baseline contract only: no session resume,
no thinking steps, no MCP. Untested; shipped as a template for wiring other
CLIs (any "prompt in, text out" CLI fits via `runtime.command` +
`extraArgs`).

## Troubleshooting

- **`401` on register**: the invite key is single-use and expires in 7 days —
  mint a fresh one. A key can also die because someone else used it first.
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
- **`mcp disabled: built entrypoint not found`**: run `pnpm build` in
  `packages/agent-bridge` (the MCP server is invoked from `dist/`).
- **Token leaked?** Remove the agent (web member list, admin) — that revokes
  every token immediately — then re-invite.
