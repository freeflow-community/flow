# Members can leave a workspace

- `[server]` `POST /v1/workspaces/:id/leave` — self-service departure, reusing
  the admin cascade (`removeMemberDeep`): channel memberships revoked, dead
  1:1 DMs cleaned up, `member.left` published, messages left in place and
  still attributed. The owner is refused ("transfer ownership first").
- `[server]` Unlike admin removal, leaving never tombstones the account, even
  when it was the last workspace — that would turn "leave one room" into
  "delete my account". The leaver keeps their login and lands on the empty
  state.
- `[server]` Sockets key their per-workspace subscription so leaving drops
  exactly that workspace's live stream, leaving the user's other workspaces
  connected; the departure event is written to the socket before the
  unsubscribe, since core NATS delivery would otherwise race it.
- `[web]` `[macos]` `[ios]` "Leave workspace" in the workspace menu, with a
  confirmation dialog and the owner's item disabled and labelled "transfer
  ownership first". Leaving drops the workspace from the switcher and lands on
  another, or the chooser when none remain.
- `[ios]` The confirmation is an `.alert`, not a `.confirmationDialog`: hung
  off the drawer the latter adapts to a popover, which renders no cancel
  button at all.
- `[bridge]` A `member.left` naming the agent itself stops the directory
  refresh and logs one line, instead of 404ing on every event that follows.
  Other members leaving is unchanged. Bridge 0.23.2.

## Feature

- **Leave a workspace you're done with.** Workspace menu → *Leave workspace*,
  on web, Mac and iPhone. It asks first, then the workspace disappears from
  your switcher and stops sending you notifications. Your past messages stay
  where they are, still under your name, and you can be re-invited later.
  Workspace owners have to hand ownership over before they can leave.
