# Agent setup Call-to-action

> **Status: Done (2026-07-23).** Streamlined `npx flow-agent-bridge` setup (four
> required prompts up front — name, handle, sponsor email, harness — everything
> else flag-overridable, then register + run) shipped in bridge `0.7.0`. Web
> sidebar gained the **Invite your Agent** button + explainer dialog above the
> profile footer, which auto-closes when the pairing prompt appears. Native
> clients don't get the CTA yet (Parity gap). See `decision_log.md` (Phase 15).

We want people to invite their agents into their Flow workspace.

First, we should make it as streamlined as possible to setup your agent. It should use
the current flow-agent-bridge package but use npx like:

    npx flow-agent-bridge

Then we should ask the minimum questions. Other values can be provided by command line args
if people want to modify them. 

Required: Bot name, handle, sponsor email, agent harness

Let's ask all required items upfront, THEN register.

Optional: host url, old token, description, working directory.

Once registration is done the bridge should be able to automatically run the coding agent
and start listening.

Now, in the lower part of the sidebar, above the profile avatar, we should add a nicely styled
button that says "Invite your Agent". Click that button opens a dialog that shows
the basic flow:

   Invite your coding agent (Claude, Codex, OpenCode, etc...) to join the workspace!

   Wherever you run your coding agent, just run:

       npx flow-agent-bridge

   Set your email as the "sponsor"... Agent will self-register and 
   you will see a popup to add them to the workspace:

   <screenshot of the popup>

   Collab with agents on tasks and code, share files and artifacts, and bring
   them onto the team.

In case they try to register their agent while this popup is open it should auto-close
if we open the Agent Register popup.


## Update

> **Status: Done (2026-07-24).** Invite codes replaced the device-code pairing
> flow. The **Invite your Agent** dialog now mints a one-time `flow-XXXX-XXXX` code on
> open and shows `npx flow-agent-bridge <code>` with a copy button. The bridge
> redeems it (`POST /v1/agents/redeem`) and joins immediately — no approval — with
> a random preset avatar (changeable in-app). Codes are single-use, 7-day TTL,
> stored hashed; any member mints via `POST /v1/workspaces/:id/agent-invites`. The
> device-code path is deleted end to end: `agent_pairing_requests` (migration
> `0022`), the `agent.pairing` event, the register/poll/approve/deny +
> `agent-avatars` routes, the web `AgentPairingPrompt`, and the bridge `register`
> subcommand. Native clients still lack the CTA (Parity gap). Bridge `0.8.0`. See
> `decision_log.md` (2026-07-24).

Instead of having the user enter their email, we should just generate an "agent invite code"
from within the Flow app. So the "Invite your Agent" popup should become operable and it
generates a one-time use invite code, and shows the user a command like this:

    npx flow-agent-bridge <invite code>

where that code is tied to the sponsor email already. The bridge should still ask for
name, handle and agent type, but then it should connect immediately (no need for approval).
The avatar should just be chosen randomly, as long as the sponsor can change it inside
the Flow app.

The invite code can only be used once.

We should get rid of the "device code" matching approach and its confirm popup.
