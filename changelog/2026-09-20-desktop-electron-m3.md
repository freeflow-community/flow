# Desktop client: OS notifications, app badge, tray (M3)

- `[desktop]` Banners go through the shell: Electron `Notification`, one per
  row id, channel name as the macOS subtitle (folded into the title elsewhere),
  sound per the account preference; a click focuses the window and jumps to
  the message, queued if the app is still starting. Badge: unread across every
  connection on the Dock (macOS) and launcher (Linux); Windows shows a dot
  overlay with the count in the tooltip. Windows/Linux get a tray icon and
  hide-on-close so banners keep working, with a "Quit when the window is
  closed" toggle in the tray menu.
- `[web]` Banners and clicks go through the host seam (browser fallback
  unchanged). "Looking at it" adds a window-focus gate on desktop only, the
  macOS app-active rule. The "Keep banners on screen" toggle is hidden on
  desktop, where that is an OS setting.

## Feature

- **The desktop app now notifies you.** Mentions, DMs, thread replies and
  reactions show as system notifications with a sound, and clicking one takes
  you to the message. The app icon shows how many things need you across all
  your servers. On Windows and Linux, closing the window keeps Flow running in
  the tray so notifications keep arriving.
