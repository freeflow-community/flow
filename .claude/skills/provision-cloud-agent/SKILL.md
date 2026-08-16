---
name: provision-cloud-agent
description: >
  Provision a cloud-hosted, always-on Flow agent: a Railway container service
  running Claude Code and the flow-agent-bridge daemon, with a persistent
  volume, GitHub access, and a repo checkout as the agent's working directory.
  Use when asked to "provision a cloud agent", "run an agent in the cloud",
  "set up a devbox agent", "host the bridge on Railway", or to give a Flow
  workspace an agent that stays online without a local machine.
---

# Provision a cloud-running Flow agent

The result: a Railway service in an existing project that boots the
`mcr.microsoft.com/devcontainers/universal:2` image, restores its tools from a
persistent volume, and runs `flow-agent-bridge` as its main process. The agent
shows online in Flow around the clock, answers @-mentions and DMs with Claude
Code, and can read and push to GitHub. Everything that matters lives on the
volume, so redeploys are safe.

## Inputs to collect first

| Input | Where it comes from |
|---|---|
| Agent name + handle (e.g. `RW1` / `rw1`) | the user |
| Flow invite code (`flow-XXXX-XXXX`) | user clicks **Invite your Agent** in the Flow sidebar. One-time use — do not waste it on a dry run |
| Claude token (`sk-ant-oat01-…`) | **the user runs** `claude setup-token` (browser approval). The CLI prints the token at the end — NOT the shorter code shown in the browser mid-flow; that code is pasted back into the CLI, and a value that does not start with `sk-ant-oat01-` is the wrong thing |
| GitHub token (optional) | the user's local `gh auth token` |
| Railway project + environment | `railway status --json` in the linked repo, or ask |
| Repo to check out as the agent's cwd | the user; cwd is the agent's identity |

Secrets should not pass through the conversation: have the user run the
`railway variable set` commands themselves (`$(gh auth token)` and the pasted
Claude token expand locally and never get printed).

## Known traps (why the steps look the way they do)

- **`railway environment edit --service-config … ` silently no-ops** ("No
  changes to apply") on current CLIs. Use the GraphQL API for the image and
  start command. The `use-railway` skill's `railway-api.sh` helper reads the
  token from `.user.token` in `~/.railway/config.json`; newer CLIs store it at
  `.user.accessToken` — use a copy with `.user.accessToken // .user.token`.
  A "Not Authorized" GraphQL error means the access token expired: run any
  CLI command (e.g. `railway whoami`) to refresh it, then retry.
- **Railway runs the container as root**, and Claude Code refuses
  `--dangerously-skip-permissions` as root (the bridge passes that flag). The
  start command must drop to the image's `codespace` user for the bridge.
- **Everything outside the volume is wiped on every redeploy**, and setting a
  variable triggers a redeploy. All installs and state go under `/workspaces`.
- **`npm install -g` without `--prefix`** lands in the image's nvm directory
  (ephemeral). Do not set `NPM_CONFIG_PREFIX` globally either — it breaks the
  image's nvm shell init. Always pass `--prefix /workspaces/.npm-global`.
- **The universal image has no long-running process** — without a start
  command override the service exits immediately.

## Steps

Substitute `<SVC>` (service name), `<HANDLE>`, ids as appropriate. Project and
environment ids below come from `railway status --json`.

### 1. Service + volume

```sh
railway add --service <SVC> --json            # ALWAYS --json
railway volume -s <service-id> -e <env-id> add -m /workspaces --json
```

### 2. Image and start command (GraphQL — see traps)

Set via `serviceInstanceUpdate`, then deploy with `serviceInstanceDeployV2`:

```graphql
mutation update($serviceId: String!, $environmentId: String, $input: ServiceInstanceUpdateInput!) {
  serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input)
}
```

`input.source = {"image": "mcr.microsoft.com/devcontainers/universal:2"}` and
`input.startCommand` = the bootstrap below (one line; build the JSON with a
script, not by hand-escaping):

```sh
bash -c '
mkdir -p /workspaces/.npm-global /workspaces/.python /workspaces/.claude /workspaces/projects;
grep -q "# persist-path" /home/codespace/.bashrc 2>/dev/null || \
  printf "\n# persist-path\nexport PATH=/workspaces/.npm-global/bin:/workspaces/.python/bin:\$PATH\n" >> /home/codespace/.bashrc;
export PATH=/workspaces/.npm-global/bin:$PATH;
command -v claude >/dev/null 2>&1 || npm install -g --prefix /workspaces/.npm-global @anthropic-ai/claude-code;
command -v flow-agent-bridge >/dev/null 2>&1 || npm install -g --prefix /workspaces/.npm-global flow-agent-bridge;
chown -R codespace:codespace /workspaces;
if [ -f /workspaces/<HANDLE>/agent.json ]; then
  cd /workspaces/<HANDLE> && exec sudo -E -u codespace env HOME=/home/codespace PATH=$PATH \
    /workspaces/.npm-global/bin/flow-agent-bridge run agent.json;
else sleep infinity; fi'
```

The `sleep infinity` fallback keeps the box reachable over SSH before the
agent is registered (and if `agent.json` ever disappears).

### 3. Variables

```sh
railway variable set --skip-deploys --service <SVC> \
  CLAUDE_CONFIG_DIR=/workspaces/.claude \
  PYTHONUSERBASE=/workspaces/.python \
  GIT_CONFIG_GLOBAL=/workspaces/.gitconfig
# The user runs these two (keeps secrets out of the transcript):
railway variable set --service <SVC> CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-...
railway variable set --service <SVC> "GH_TOKEN=$(gh auth token)"
```

Warn the user: service variables are visible to every member of the Railway
project. Wait for the triggered redeploy to reach SUCCESS (poll
`railway deployment list --service <SVC> --json`; never report success before
seeing it).

### 4. Register the agent (one-time, on the box)

```sh
railway ssh --service <SVC> -- bash -c '
export PATH=/workspaces/.npm-global/bin:$PATH
mkdir -p /workspaces/<HANDLE> /workspaces/projects
cd /workspaces/<HANDLE>
timeout 45 flow-agent-bridge --invite <INVITE-CODE> --name <NAME> --handle <HANDLE> \
  --harness claude --cwd /workspaces/projects/<REPO>
ls -l agent.json'
```

The redemption is immediate (no approval step); the daemon it starts dies with
the timeout, which is fine — the start command owns the daemon from here.
`agent.json` holds the token: it must be on the volume, chmod 600. Do not cat
it.

### 5. Give the agent its repo

```sh
railway ssh --service <SVC> -- bash -c '
git clone https://<REPO-URL> /workspaces/projects/<REPO>
git config --global user.name "<NAME>"; git config --global user.email "<EMAIL>"
gh auth setup-git'
```

(`gh` reads `GH_TOKEN` from the environment; `setup-git` wires git's HTTPS
credential helper. `GIT_CONFIG_GLOBAL` makes it persist.)

### 6. Deploy and verify — all three, not just the first

1. `serviceInstanceDeployV2`, poll until `SUCCESS`.
2. `railway logs --service <SVC>` shows
   `[bridge …] <NAME> <@id> online in "<workspace>" … cwd=/workspaces/projects/<REPO>`.
3. `railway ssh --service <SVC> -- ps -o user,cmd -C node` shows the bridge
   owned by `codespace`, **not root** — root here means the agent will error
   on its first real message even though it shows online.

Then have the user @-mention the agent in Flow as the true end-to-end test.

## Day-2 notes

- Users can send the agent `/reset` (fresh conversation), `/restart`, and
  `/update` (bridge self-updates and restarts) inside Flow.
- The repo checkout drifts; tell the agent to `git pull`, or add a pull to the
  start command.
- Grow the volume or add apt packages? Volume: Railway dashboard. Apt: bake a
  custom image instead of installing on every boot.
- Lost `agent.json`: `flow-agent-bridge login` re-mints the token (revokes the
  old one). Lost the Claude token: `claude setup-token` again, update the
  variable.
