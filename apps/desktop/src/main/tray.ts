// Tray icon for Windows and Linux (docs/specs/desktop-electron.md, "Windows,
// tray and quitting"). Closing the last window hides the app here and keeps
// it running, so banners and the badge keep working — the platform
// equivalent of the macOS app staying in the Dock. macOS gets no tray; the
// Dock already does this job there. A checkbox turns hide-on-close off.
import path from 'node:path';
import { app, Menu, nativeImage, Tray } from 'electron';
import { packageRoot } from './config.js';
import { loadPrefs, savePrefs } from './prefs.js';

let tray: Tray | null = null;

export function traySupported(): boolean {
  return process.platform === 'win32' || process.platform === 'linux';
}

export function installTray(actions: { showWindow: () => void; quit: () => void }): void {
  if (!traySupported() || tray) return;
  const icon = nativeImage.createFromPath(path.join(packageRoot, 'resources', 'tray.png'));
  tray = new Tray(icon);
  tray.setToolTip('Flow');
  const rebuild = () => {
    const prefs = loadPrefs();
    tray!.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open Flow', click: actions.showWindow },
      { type: 'separator' },
      {
        label: 'Quit when the window is closed',
        type: 'checkbox',
        checked: prefs.quitOnClose === true,
        click: (item) => { savePrefs({ quitOnClose: item.checked }); rebuild(); },
      },
      { type: 'separator' },
      { label: 'Quit Flow', click: actions.quit },
    ]));
  };
  rebuild();
  tray.on('click', actions.showWindow);
  app.on('before-quit', () => { tray?.destroy(); tray = null; });
}

export function setTrayUnread(count: number): void {
  tray?.setToolTip(count > 0 ? `Flow — ${count} unread` : 'Flow');
}
