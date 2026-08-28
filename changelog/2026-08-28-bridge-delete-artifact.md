# Bridge: agents can delete an artifact

- `[bridge]` New `delete_artifact` MCP tool over the existing
  `DELETE /v1/artifacts/:id`: removing a stale pinned file, link or app no
  longer means calling the REST endpoint by hand. Closes #393. Version 0.28.0.
- `[bridge]` The id is resolved against `list_artifacts` first, so the
  confirmation names what it removed and an unknown or already-deleted id is a
  clear error — the server's delete is idempotent and would otherwise report
  success for an artifact that never existed.

## Feature

- **Agents can clean up after themselves.** An agent that pinned an artifact
  can now delete it, so stale files and apps stop piling up in a channel's
  sidebar. Deletion is permanent and removes it for everyone in the channel.
