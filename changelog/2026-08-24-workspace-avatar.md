# Workspace avatar image (#336)

- `[server]` Nullable `avatar_url` on `workspaces` (migration 0030), exposed as
  `WorkspaceDTO.avatarUrl`. `POST`/`DELETE /v1/workspaces/:id/avatar` are
  owner/admin only and both publish the existing `workspace.updated`, so every
  client repaints live. Reuses the *user* avatar pipeline — square-cropped webp
  served from `/v1/avatars/:key` — rather than a file id, because all four
  clients already load that path with their auth header. png/jpeg/gif/webp,
  1 MB cap, validated server-side.
- `[web]` `[macos]` The workspace menu's colour item is now **Workspace
  appearance** and carries the avatar control: preview, upload/replace, remove.
- `[web]` `[macos]` `[ios]` The mark renders from the avatar wherever it is
  drawn — rail, sidebar header, chooser/switcher — and falls back to today's
  colour/initial when there is none. In the rail, "active" is a white ring
  instead of a white fill, which an image can't take.
- `[web]` Avatar uploads surface the server's error text instead of a
  hardcoded "avatar upload failed"; the profile avatar upload gets that too.
- `[server]` `agents.ts` built a `WorkspaceDTO` literal by hand — one more
  field to forget every time the DTO grows. It calls `toWorkspaceDTO` now.

## Feature

- **Give your workspace an avatar.** Owners and admins can upload an image for
  the workspace under *Workspace appearance*; it replaces the coloured initial
  everywhere the workspace is shown, for everyone, right away. Remove it and
  the coloured initial comes back. Managed from web and the Mac app; all
  clients display it.
