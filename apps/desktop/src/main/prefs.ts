// Small per-profile shell preferences (`prefs.json` under userData). These
// are the shell's own settings, not Flow account preferences — those live on
// the server and travel with the account.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

export interface ShellPrefs {
  /** Windows/Linux: quit when the last window closes instead of hiding to
   * the tray. Off by default so banners and the badge keep working. */
  quitOnClose?: boolean;
}

const FILE = 'prefs.json';

function file(): string {
  return path.join(app.getPath('userData'), FILE);
}

export function loadPrefs(): ShellPrefs {
  try {
    const raw = JSON.parse(readFileSync(file(), 'utf8')) as ShellPrefs;
    return raw && typeof raw === 'object' ? raw : {};
  } catch { return {}; }
}

export function savePrefs(patch: Partial<ShellPrefs>): ShellPrefs {
  const next = { ...loadPrefs(), ...patch };
  try { writeFileSync(file(), JSON.stringify(next)); } catch { /* best effort */ }
  return next;
}
