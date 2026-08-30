# iOS channel banner follows the workspace's sidebar color

- `[ios]` The floating header pill now fills with the active workspace's
  `SidebarPalette` gradient instead of the hardcoded violet `MC.sidebarGradient`
  — the same source of truth the drawer reads, so a navy workspace no longer
  shows a purple banner (#427).
- `[ios]` The pill observes the workspaces table itself, so recoloring the
  workspace repaints it live, and any screen adopting the floating header
  inherits the behaviour.

## Feature

- **The channel banner matches your workspace color on iPhone.** Pick a sidebar
  color and the colored header above the conversation follows it right away,
  instead of staying purple.
