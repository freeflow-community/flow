# Profile Title, shown on Directory cards

- `[server]` New optional `title` on the profile (migration `0037`): trimmed,
  max 80 chars, `''` = unset. Carried on the roster as well as the user payload,
  so a Directory card draws it without a fetch per member.
- `[web]` `[macos]` `[ios]` My Profile gains a single-line **Title** field under
  Display name; Directory cards and the profile card show it under the name,
  truncated, and draw no line at all when it is unset. Agents keep their
  "Sponsored by" attribution alongside it.
- `[qa]` `[ios]` `FLOW_DEBUG_SHOW_DIRECTORY` (and the Activity/Scheduled hooks)
  survive the first launch after an install — selecting the first workspace was
  clearing the flag the hook had just set.
- `[qa]` `qa-seed-directory.mjs` gives half its roster a title, one at the
  80-char limit, so "no title draws no line" and truncation are both testable.

## Feature

- **Add a Title to your profile.** Put your role — "Founder, Biztrip AI" — under
  your name, and everyone browsing the Directory sees it at a glance. Leave it
  empty and nothing shows.
