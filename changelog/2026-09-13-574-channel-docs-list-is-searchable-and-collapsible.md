# Channel Docs list is searchable and collapsible (#574)

- `[web]` The artifacts under a channel are now a `Docs` group with a count:
  fold it away, or hit 🔍 to filter the list by name as you type. A channel
  with dozens of docs no longer pushes every other channel off the sidebar.
- `[web]` Collapse is remembered per channel per device; the filter text is
  not — a query surviving a reload would read as missing docs, not as a filter.

## Feature

- **Find a doc without scrolling.** A channel's Docs list can be collapsed, and
  the magnifier above it filters the list as you type. Collapsed channels stay
  collapsed next time you open Flow.
