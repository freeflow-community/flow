# A sole owner can delete their workspace

Follow-up to the leave-workspace entry: the owner gate it shipped had a dead
end. An owner who is the only person left could not leave (nobody to transfer
to) and nothing else could end the workspace.

- `[server]` `DELETE /v1/workspaces/:id` — owner only, refused (409
  `workspace_not_empty`) while another *human* is a member. Agents and bots
  don't count as company, but are torn down rather than orphaned: their
  credentials are revoked before the cascade drops the memberships, or a
  daemon keeps authenticating against a workspace that no longer exists.
  File and avatar blobs are swept first; everything else rides the
  `workspaces` row's `ON DELETE CASCADE`.
- `[server]` `WorkspaceMemberDTO` gains `isBot`. It carried `isAgent` but
  nothing for app bots, so a client counting "people" mistook a bot for
  company and disagreed with the server's delete guard.
- `[web]` `[macos]` `[ios]` The workspace-menu item now has three states:
  "Leave workspace" for a member, disabled "transfer ownership first" for an
  owner with company, "Delete workspace" for an owner left alone. Deletion
  confirms, then reuses the leave path's teardown — same event, same landing.
- `[macos]` `[ios]` Local cache migration `v17` adds `user.isBot`.

## Feature

- **Delete a workspace nobody else is in.** If you own a workspace and you're
  the last person in it, the workspace menu offers *Delete workspace* — there's
  nobody to hand it to. It asks first, and it removes the workspace and
  everything in it for good.
