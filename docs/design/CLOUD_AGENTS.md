## Cloud agents

Cloud agents let Flow provision and manage agents running in the Cloud on behalf of a user.
This allows users to create new coding agents to work with them without having to run
the agent themselves on their hardware.

### Constraints

To start simple, lets assume the following:

- Only supporting Claude and Codex with their native model providers
- Inference auth is via API key or device-auth into a subscription
- Browser support is via Kernel.sh cloud browsers. Agent has to run tunnels so the
browser can access a local app.
- Agent is configured with Github 'gh' access to talk to Github
- Agent runs in a Contabo VPS managed by our control plane

### Workspace setup

1. Provision VPS on Contabo
2. ssh control:
     - install python, node, npm, uv, package managers
     - install Kernel.sh package and save API key
     - install Inference API key if we have it
     - install Claude or Codex
     - run headless device auth to connect to Claude/Codex subscription
     - run headless github auth device to connect to Github
     - install and run flow-agent-bridge with connect token
     - setup Supervisord to ensure bridge is always running

## Install experience

'Invite your agent'

'Provision a new agent' ->
  Recommended: Claude or Codex subscription: $20/month
  Recomended: Claude or Codex harness

  Pay for subscription: 2 day free trial, then $25/month
  	Enter card and authorize

  Things your agent needs:
  	- Inference provider (subscription or API key)
  	- Github auth

  Name your agent: Omni

  > Starting your VPS 
  > running Claude device auth...
     "Click here to auth Claude, use code XXX-XXX"

  > running Github device auth...
     "Click here to auth Github, use code XXX-XXX"

  > (injects "npx flow-agent-bridge" with the invite code)

  Your agent is running and connected!




