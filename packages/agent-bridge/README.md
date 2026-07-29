# flow-agent-bridge

Run an AI coding agent (Claude Code, Codex, or any "prompt in, text out" CLI)
as a **first-class member of a [Flow](https://app.freeflow.im) workspace** —
real presence, DMs, @-mentions, threads, file attachments, and live
"thinking…" progress while it works.

```
Flow WS ──> flow-agent-bridge daemon ──spawn──> claude -p --resume <session>
   ^                                                  │ stream-json
   └────── replies / reactions / uploads <────────────┘
```

## Install & run

```sh
npx flow-agent-bridge <invite-code>   # no install; setup on first run, daemon after
```

Get the `<invite-code>` from Flow: click **Invite your Agent** at the bottom of
the sidebar and copy the one-time `npx flow-agent-bridge flow-K7P2-9QMR` command it
shows. The first run asks only **agent name, handle, harness** (claude / codex /
demo), then redeems the code and joins the workspace **immediately** — no
approval step. The code is exchanged for a permanent agent token, the config is
saved to `agent.json` (chmod 600) next to where you ran it, and the daemon
starts. The agent gets a random avatar the sponsor can change inside Flow.
Subsequent runs just start the daemon.

Every prompt can be pre-answered with a flag, so the whole thing runs
unattended:

```sh
npx flow-agent-bridge --invite flow-K7P2-9QMR --name RepoBot --handle repobot --harness claude
```

| Flag | Default | Meaning |
|---|---|---|
| `--invite` | prompted (or the positional `<invite-code>`) | the one-time invite code |
| `--name` / `--handle` / `--harness` | prompted | agent name, @handle, runtime |
| `--server` (or `--host`) | `https://app.freeflow.im` | Flow server URL |
| `--token` | — | reuse an existing `flow-agent-token-…` (skips onboarding) |
| `--description` | none | one-line agent description |
| `--cwd` | current directory | working directory the agent runs in (its identity) |

Already have an agent? `--token flow-agent-token-…` reconnects as it and skips
onboarding.

## What you get

- **Answers in threads** — @-mention the agent in a channel and it replies in
  a **new thread** on your message rather than in the channel proper. After
  that it answers every reply in that thread without needing another mention.
  DMs stay inline.
- **One CLI session per conversation** — each DM or thread maps to a
  persistent `--session-id`/`--resume` session; separate conversations run
  concurrently, turns within one are serialized. Send `/reset` to start a
  conversation fresh.
- **Self-updating** — the CLI runs the daemon under a small supervisor, so
  sending **`/update`** (DM it, or @-mention + `/update` in a channel) makes
  the bridge npm-install the latest package and restart itself, then post
  "back online — vX" where it was asked; **`/restart`** relaunches without
  updating. Crashes respawn automatically with backoff. Installs running from
  a source checkout restart but skip the npm update (pull + build by hand).
- **Thinking steps** — tool calls stream into one status message that edits
  in place while the agent works, then the final reply posts clean.
- **Attachments both ways** — incoming images/files are downloaded locally
  and offered to the agent (Claude renders images natively); the agent can
  send files back via the bundled `flow` MCP server (`send_message`,
  `react`, `upload_file`, `search_history`).
- **cwd is the identity** — point the agent at a repo checkout and
  "@RepoBot fix the failing test" runs the CLI in that repo.
- **Safety rails** — sender gating, self/agent loop guards, `--max-turns` +
  wall-clock caps. Permissions default to full access in the cwd; set
  `allowedTools`/`permissionMode` to scope an agent down.

## Config

`agent.json` (created by the wizard; edit freely, restart to apply):

```json
{
  "serverUrl": "https://app.freeflow.im",
  "agentToken": "flow-agent-token-…",
  "runtime": {
    "kind": "claude",
    "cwd": "~/checkouts/repo-x"
  },
  "eventScope": "mentions",
  "progress": "thinking",
  "concurrency": 4
}
```

| Key | Default | Meaning |
|---|---|---|
| `runtime.kind` | `claude` | `claude`, `codex` (stub), or `demo` (canned reply — wiring check) |
| `runtime.cwd` | config dir | working directory the CLI runs in (`~` expands) |
| `runtime.allowedTools` / `permissionMode` | unset = allow everything | set either to scope the agent down (e.g. `["Read", "Grep"]`) |
| `runtime.idleTimeoutSec` | 120 | kill a turn after this long with **no output** — a turn that keeps working never expires, however long it takes |
| `runtime.maxTurns` / `timeoutSec` | 100 / 3600 | runaway backstops (`timeoutSec` is the absolute per-turn wall clock, in seconds) |
| `eventScope` | `mentions` | `mentions` (@-mentions + DMs) or `all` channel traffic. Replies in threads the agent is already in are always answered, under either setting. |
| `progress` | `thinking` | `thinking` \| `typing` \| `silent` |
| `logFile` | `<config>.log` next to the config | daemon log file (rotates once at 5 MB); JSON `null` disables |

Headless runtimes authenticate however the CLI normally does (e.g.
`claude setup-token` or `ANTHROPIC_API_KEY` in the daemon's environment).

## Use the flow MCP server directly (no daemon)

`flow-agent-bridge mcp-init [agent.json]` writes a `.mcp.json` in the current
directory, so MCP clients (the Claude CLI, Claude Desktop) load the bundled
`flow` server and act as the agent: read/post/search/upload via the MCP
tools, pull-only — no presence or push, that's the daemon's job. Other
servers in an existing `.mcp.json` are preserved; the file is git-ignored
since it holds the agent token.

## Keep it running

The daemon only dials out (HTTPS + WSS) — no open ports needed. Under
systemd:

```ini
[Service]
ExecStart=/usr/bin/env flow-agent-bridge /home/me/mybot.json
Restart=always
```

It reconnects through server restarts on its own; run the wizard once
interactively before enabling the unit.
