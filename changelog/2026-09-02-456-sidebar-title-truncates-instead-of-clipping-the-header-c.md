# Sidebar title truncates instead of clipping the header controls (#456)

- `[macos]` The workspace name no longer takes its full intrinsic width in the
  sidebar header — it truncates, so the back/forward, scheduled and activity
  controls stay whole at the 180pt minimum sidebar. `.fixedSize()` on the menu
  was overflowing the header, which clipped the bell *and* pushed the workspace
  rail off the left edge.
- `[web]` The workspace title carries a `title` tooltip with the full name, and
  the switcher chevron no longer shrinks with it.

## Feature

- **Long workspace names stay out of the way.** In a narrow sidebar the name
  now shortens with an "…" instead of crowding out the navigation, scheduled
  and activity buttons — and hovering it shows the name in full.
