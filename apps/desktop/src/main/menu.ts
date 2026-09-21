// The application menu. On macOS it is what makes Cmd+C / Cmd+V / Cmd+Q work
// at all (Electron has no menu by default); on Windows and Linux it is
// hidden behind Alt so the accelerators still fire. Text zoom is a menu
// command that persists per profile, matching the macOS app's Cmd+/Cmd−/Cmd0.
// Cmd+F is deliberately absent: the web client's own find bar handles it.
import { app, BrowserWindow, Menu, shell, type MenuItemConstructorOptions } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ZOOM_FILE = 'zoom.json';
const ZOOM_MIN = -3;
const ZOOM_MAX = 5;

export function loadZoomLevel(): number {
  try {
    const level = (JSON.parse(readFileSync(path.join(app.getPath('userData'), ZOOM_FILE), 'utf8')) as { level?: number }).level;
    return typeof level === 'number' && Number.isFinite(level) ? clamp(level) : 0;
  } catch { return 0; }
}

function saveZoomLevel(level: number): void {
  try { writeFileSync(path.join(app.getPath('userData'), ZOOM_FILE), JSON.stringify({ level })); } catch { /* best effort */ }
}

function clamp(level: number): number {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(level * 2) / 2));
}

/** Set the zoom on every window and remember it. */
export function applyZoom(level: number): number {
  const clamped = clamp(level);
  for (const win of BrowserWindow.getAllWindows()) win.webContents.setZoomLevel(clamped);
  saveZoomLevel(clamped);
  return clamped;
}

function stepZoom(delta: number): void {
  const current = BrowserWindow.getFocusedWindow()?.webContents.getZoomLevel() ?? loadZoomLevel();
  applyZoom(current + delta);
}

export function installMenu(options: { helpUrl: string; onCheckForUpdates?: () => void }): void {
  const isMac = process.platform === 'darwin';
  const view: MenuItemConstructorOptions = {
    label: 'View',
    submenu: [
      { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: () => applyZoom(0) },
      { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: () => stepZoom(0.5) },
      { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => stepZoom(-0.5) },
      { type: 'separator' },
      { role: 'togglefullscreen' },
      ...(app.isPackaged ? [] : [{ type: 'separator' } as const, { role: 'toggleDevTools' } as const, { role: 'reload' } as const]),
    ],
  };
  const help: MenuItemConstructorOptions = {
    role: 'help',
    submenu: [
      { label: 'Flow Help', click: () => void shell.openExternal(options.helpUrl) },
      ...(options.onCheckForUpdates && !isMac ? [{ label: 'Check for Updates…', click: options.onCheckForUpdates }] : []),
      ...(isMac ? [] : [{ type: 'separator' } as const, { role: 'about' } as const]),
    ],
  };
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        ...(options.onCheckForUpdates ? [{ label: 'Check for Updates…', click: options.onCheckForUpdates }, { type: 'separator' } as const] : []),
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    } as MenuItemConstructorOptions] : []),
    {
      label: 'File',
      submenu: [isMac ? { role: 'close' } : { role: 'quit' }],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
        ...(isMac ? [{ role: 'pasteAndMatchStyle' } as const, { role: 'delete' } as const, { role: 'selectAll' } as const,
          { type: 'separator' } as const,
          { label: 'Speech', submenu: [{ role: 'startSpeaking' }, { role: 'stopSpeaking' }] } as MenuItemConstructorOptions]
          : [{ role: 'delete' } as const, { type: 'separator' } as const, { role: 'selectAll' } as const]),
      ],
    },
    view,
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' }, { role: 'zoom' },
        ...(isMac ? [{ type: 'separator' } as const, { role: 'front' } as const] : [{ role: 'close' } as const]),
      ],
    },
    help,
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
