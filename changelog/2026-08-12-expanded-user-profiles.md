# Expanded user profiles: personal website + bio

- `[server]` `[web]` `[macos]` `[ios]` Profiles gain a `website` link and a
  free-text `bio`, editable on all three clients. Migration `0029`.
- `[server]` `website` is allowlisted to absolute `http`/`https` URLs in
  `PatchMeBody` — a profile link is rendered by every client, so an arbitrary
  string would make `javascript:`/`data:` URLs stored XSS. Limits: 200 for the
  website, 500 for the bio.
- `[web]` `[macos]` `[ios]` The bio is plain text with newlines kept, never
  markdown; each client renders it in an escaping node. Clients re-check the
  URL scheme before linking, and the edit forms explain a bad link instead of
  failing on save.
- `[ios]` `[qa]` `FLOW_DEBUG_OPEN_PROFILE=1` opens My Profile at launch, so a
  headless run reaches the form without tap automation.

## Feature

- **Say more about yourself.** Your profile now takes a personal website link
  and a short bio, and both show on your profile card for teammates to see.
  Links must be full `http://` or `https://` addresses.
