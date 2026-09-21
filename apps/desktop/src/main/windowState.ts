// Remember where the window was, and put it back there when it is still on
// a display. Stored per profile in userData; the pure logic is in lib/bounds.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { app, screen, type BrowserWindow } from 'electron';
import { parseWindowState, restoreBounds, type Rect, type SavedWindowState } from './lib/bounds.js';

const FILE = 'window-state.json';

function file(): string {
  return path.join(app.getPath('userData'), FILE);
}

export function loadWindowState(): SavedWindowState | null {
  try { return parseWindowState(readFileSync(file(), 'utf8')); } catch { return null; }
}

export function initialBounds(saved: SavedWindowState | null): Rect {
  const displays = screen.getAllDisplays().map(d => d.workArea);
  return restoreBounds(saved, displays, screen.getPrimaryDisplay().workArea);
}

/** Save on every move/resize (debounced) and on close. */
export function trackWindowState(win: BrowserWindow): void {
  let timer: NodeJS.Timeout | null = null;
  const save = () => {
    if (win.isDestroyed()) return;
    const maximized = win.isMaximized();
    // Save the normal bounds, not the maximized ones, so un-maximizing later
    // restores the size the person chose.
    const rect = maximized ? win.getNormalBounds() : win.getBounds();
    const state: SavedWindowState = { ...rect, maximized };
    try { writeFileSync(file(), JSON.stringify(state)); } catch { /* best effort */ }
  };
  const later = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, 400);
  };
  win.on('resize', later);
  win.on('move', later);
  win.on('maximize', later);
  win.on('unmaximize', later);
  win.on('close', () => { if (timer) clearTimeout(timer); save(); });
}
