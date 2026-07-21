# flow-agent-bridge

Run an AI coding agent (Claude Code, Codex, or any "prompt in, text out" CLI)
as a **first-class member of a [Flow](https://app.flowtoo.org) workspace** —
real presence, DMs, @-mentions, threads, file attachments, and live
"thinking…" progress while it works.

```
Flow WS ──> flow-agent-bridge daemon ──spawn──> claude -p --resume <session>
   ^                                                  │ stream-json
   └────── replies / reactions / uploads <────────────┘
```

## Install & run

```sh
npm install -g flow-agent-bridge
flow-agent-bridge            # interactive setup on first run, daemon after
```

The first run walks you through everything: paste the server URL + one-time
invite key (a workspace admin mints it via **Invite an Agent…**), the key is
exchanged for a permanent agent token, and the config is saved to
`agent.json` (chmod 600) next to where you ran it. Subsequent runs just
start the daemon. Already have an agent? Paste a regenerated
`flow-agent-token-…` instead of an invite key to reconnect as it.

## What you get

- **One CLI session per conversation** — each DM or thread maps to a
  persistent `--session-id`/`--resume` session; separate conversations run
  concurrently, turns within one are serialized. Send `/reset` to start a
  conversation fresh.
- **Thinking steps** — tool calls stream into one status message that edits
  in place while the agent works, then the final reply posts clean.
- **Attachments both ways** — incoming images/files are downloaded locally
  and offered to the agent (Claude renders images natively); the agent can
  send files back via the bundled `flow` MCP server (`send_message`,
  `react`, `upload_file`, `search_history`).
- **cwd is the identity** — point the agent at a repo checkout and
  "@RepoBot fix the failing test" runs the CLI in that repo.
- **Safety rails** — pre-scoped tool permissions (read-only by default),
  sender gating, self/agent loop guards, `--max-turns` + wall-clock caps.

## Config

`agent.json` (created by the wizard; edit freely, restart to apply):

```json
{
  "serverUrl": "https://app.flowtoo.org",
  "agentToken": "flow-agent-token-…",
  "runtime": {
    "kind": "claude",
    "cwd": "~/checkouts/repo-x",
    "permissionMode": "acceptEdits",
    "allowedTools": ["Read", "Grep", "Glob", "Bash(pnpm test:*)"]
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
| `runtime.allowedTools` | `[]` | pre-granted permissions — headless runs can't prompt |
| `runtime.maxTurns` / `timeoutSec` | 100 / 300 | runaway caps |
| `eventScope` | `mentions` | `mentions` (@-mentions + DMs) or `all` channel traffic |
| `progress` | `thinking` | `thinking` \| `typing` \| `silent` |

Headless runtimes authenticate however the CLI normally does (e.g.
`claude setup-token` or `ANTHROPIC_API_KEY` in the daemon's environment).

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
