# Privacy mode hides your email and takes you out of the Directory (#489)

- `[server]` New `users.privacy_mode` flag (default off), written only through
  `PATCH /v1/me`. With it on, `visibleEmail()` empties the address on every
  surface that carried one — roster, profile fetch, `user.updated` /
  `member.joined` events, Slack-compat — and the owner still sees their own.
- `[server]` `toUserDTO` now takes the viewer and defaults to redacting, so a
  call site that forgets who is looking errs toward hiding.
- `[web]` Settings gains a Privacy section: your own email, read-only, and the
  toggle. Live-saved, and it refreshes the roster so the Directory reacts at
  once.
- `[web]` The Directory leaves privacy-mode members out of the listing *and*
  the search — hidden from the grid but findable by name would not be hidden.
  They stay on the roster: mentions, DMs and channel membership are untouched.
- `[bridge]` `list_users` omits the address column for a hidden member rather
  than printing a gap (0.30.0).
- `[qa]` Hidden addresses travel as `''`, not an absent key: macOS and iOS
  decode `email` as a non-optional `String`, so omitting it would break their
  roster decode today. Privacy-mode members still receive the #481 admin
  broadcast — that send is server-side and returns counts only, so it exposes
  nothing.

## Feature

- **Privacy mode.** A switch in Settings that hides your email address from
  everyone else in Flow and takes you out of the workspace Directory. You still
  see your own address, and you are still in every channel and DM you were in —
  people can still find you and @-mention you, they just can't look you up or
  read your email.
