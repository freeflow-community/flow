# Channel browser replaces the sidebar Browse list (#588)

- `[server]` `GET /v1/workspaces/:id/channels?includeArchived=1` adds archived public channels; list items carry `memberCount`. Default list unchanged.
- `[server]` Reacting and pinning in an archived channel now fail with `channel_archived`, like posting, joining and inviting.
- `[web]` "Browse all" row under Channels opens a searchable channel browser (Join / Joined, include-archived toggle); the inline Browse list is gone.
- `[web]` Archived channels open read-only: banner, full history, no composer, reactions or hover menu.

## Feature

- **Browse every channel in one place.** "Browse all" at the end of your Channels list opens a searchable list of every public channel, with member counts and a Join button. Turn on "Include archived" to find old channels and read their history — archived channels open read-only. On the web for now.
