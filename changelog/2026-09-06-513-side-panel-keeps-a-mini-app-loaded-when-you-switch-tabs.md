# Side panel keeps a mini-app loaded when you switch tabs (#513)

- `[web]` `[macos]` The side panel now keeps the most recently viewed link
  artifact's frame mounted (hidden) while another tab shows, so a Thread ↔ app
  toggle no longer reloads the page through the tunnel and re-mints a token.
- `[web]` `[macos]` Scoped to `kind === 'link'` and one frame at a time, dropped
  on channel change or panel close — file viewers are cheap to rebuild, so they
  still unmount as before.
- `[web]` `[macos]` The rule is a pure `nextKeepAlive` on both clients, tested
  case-for-case so the two can't drift. iOS needs nothing: its artifact viewer
  is a full-screen sheet with no other tab to toggle to.

## Feature

- **Mini apps stay put when you flip between tabs.** Switching from an open app
  to the Thread tab and back is now instant, and the app is exactly where you
  left it — same scroll position, same filters — instead of reloading from
  scratch. Reopening it after closing the panel still starts fresh, and the
  address bar's Go still forces a real reload.
