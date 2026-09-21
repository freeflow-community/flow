// Right-click menu. Electron ships none, so without this there is no way to
// paste into a field with the mouse and no spelling suggestions — both of
// which the native text view on macOS gives for free.
import { clipboard, Menu, shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';
import { isOpenableExternally } from './lib/argv.js';

export function installContextMenu(win: BrowserWindow): void {
  win.webContents.on('context-menu', (_event, params) => {
    const items: MenuItemConstructorOptions[] = [];
    if (params.misspelledWord) {
      for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
        items.push({ label: suggestion, click: () => win.webContents.replaceMisspelling(suggestion) });
      }
      if (params.dictionarySuggestions.length === 0) items.push({ label: 'No guesses found', enabled: false });
      items.push({ label: 'Add to Dictionary', click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord) });
      items.push({ type: 'separator' });
    }
    if (params.linkURL && isOpenableExternally(params.linkURL)) {
      items.push({ label: 'Open Link in Browser', click: () => void shell.openExternal(params.linkURL) });
      items.push({ label: 'Copy Link', click: () => clipboard.writeText(params.linkURL) });
      items.push({ type: 'separator' });
    }
    if (params.isEditable) {
      items.push({ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' });
    } else if (params.selectionText.trim()) {
      items.push({ role: 'copy' });
    }
    if (params.mediaType === 'image' && params.srcURL) {
      if (items.length) items.push({ type: 'separator' });
      items.push({ label: 'Copy Image', click: () => win.webContents.copyImageAt(params.x, params.y) });
    }
    if (items.length === 0) return;
    Menu.buildFromTemplate(items).popup({ window: win });
  });
}
