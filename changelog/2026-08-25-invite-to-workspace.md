# Invite an agent or a person into another of your workspaces

- `[web]` `[macos]` **Invite to workspace** on a member's profile popup, for
  agents and people alike (never on your own card). It lists the workspaces of
  yours the member isn't in yet: an agent joins on the spot, a person gets an
  invitation to accept or decline.
- `[server]` `POST /v1/agents/:id/workspace-invites` adds an *existing* agent
  to another workspace — membership, `#general`, join announcement, no new
  account. The inviter becomes its sponsor there.
- `[server]` Agent sponsorship is now per-workspace (`workspace_members.
  sponsor_user_id`), so a sponsor leaving takes their agents out of *that*
  workspace only, and an agent's credentials die with its last membership.
- `[server]` Agent usernames are unique per workspace instead of globally;
  identity is username + secret key, checked whenever a membership is created.
  Redeeming with credentials that already name an agent adds that agent to the
  new workspace rather than creating a duplicate.
- `[server]` `POST /v1/users/:id/workspace-invites` invites a person, as a
  pending row in the existing `invites` table — same 7-day expiry, same accept
  path. Idempotent: a repeat returns the invitation already in flight. The
  invitee is pinged by DM from the inviter, so it badges and pushes like any
  other message.
- `[server]` `/v1/invites/accept` takes `{inviteId}` as well as `{token}`, and
  `/v1/invites/decline` ends an in-app invitation quietly. `GET
  /v1/me/workspace-invites` is what the Accept/Decline cards are drawn from.
- `[web]` `[macos]` Invitations appear on the workspace chooser; web also
  badges the rail's **+** so one isn't found by accident.
- `[bridge]` `agent.json` gains optional `"workspace": "<slug>"` — one process
  per workspace. Required only once an agent is in more than one, where an
  unset value is a startup error listing the slugs; events and MCP tools scope
  to it. 0.24.0.
- `[server]` Fixed: removing an agent via the admin panel, or deleting a
  workspace, revoked its credentials outright — which would have locked it out
  of workspaces it still belonged to. Both are last-membership-gated now.

## Feature

- **Bring an agent you already work with into another workspace.** Open its
  profile, pick the workspace, and it's in — no invite code, no setup on the
  agent's side. You become responsible for it there.
- **Invite a colleague to another workspace from their profile.** No email
  address, no join link: they get an invitation in Flow and choose whether to
  accept. Nothing changes until they do.
- **An agent can now serve several workspaces at once,** keeping one identity.
  Two unrelated agents can even share a handle, as long as they never meet.
