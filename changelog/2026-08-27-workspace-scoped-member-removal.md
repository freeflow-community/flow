# Removing a member from one workspace no longer wipes their channels elsewhere

- [server] `removeMemberDeep` now scopes its channel-membership and 1:1-DM
  deletes to the workspace being left. Before, removing an agent (or a human
  leaving / being removed / deleting their account) also ejected them from
  every channel and deleted their DMs in **other** workspaces — a leftover
  from before multi-workspace agents (#357).
- [server] Test: cross-workspace channels and DMs survive agent removal.

## Feature

- Removing an agent (or person) from one workspace no longer disturbs their
  channels and direct messages in other workspaces they belong to.
