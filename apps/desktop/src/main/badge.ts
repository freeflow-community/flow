// The app badge (docs/specs/desktop-electron.md, "Badge"): the unread
// notifications total across every connection, as the renderer computes it.
// macOS shows the number on the Dock icon and Linux on launchers that
// support it (`app.setBadgeCount`); Windows has no numeric badge API, so the
// taskbar button gets a red dot overlay and the count goes in its tooltip.
import path from 'node:path';
import { app, BrowserWindow, nativeImage, type NativeImage } from 'electron';
import { packageRoot } from './config.js';

let overlay: NativeImage | null = null;
let current = 0;

function overlayIcon(): NativeImage {
  overlay ??= nativeImage.createFromPath(path.join(packageRoot, 'resources', 'overlay-unread.png'));
  return overlay;
}

export function badgeCount(): number {
  return current;
}

export function setBadge(count: number): void {
  current = Math.max(0, Math.floor(count));
  if (process.platform === 'win32') {
    for (const win of BrowserWindow.getAllWindows()) {
      win.setOverlayIcon(current > 0 ? overlayIcon() : null, current > 0 ? `${current} unread` : '');
    }
    return;
  }
  app.setBadgeCount(current);
}
