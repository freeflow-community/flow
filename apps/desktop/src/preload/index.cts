// The bridge (docs/specs/desktop-electron.md, "Bridge contract"): what the
// renderer may ask the shell for, exposed as `window.flowDesktop` and typed
// by `FlowDesktopBridge` in @flow/shared. This runs sandboxed with context
// isolation, so it is plain CommonJS with `require('electron')` only.
//
// Credentials are mirrored in memory here so the web client's token reads
// stay synchronous; writes go to the main process, which encrypts them
// with the OS store. Focus and zoom are mirrored the same way.
import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopInfo, DesktopLinks, DesktopSecrets, DesktopWindow, DesktopZoom, FlowDesktopBridge } from '@flow/shared';

const info = ipcRenderer.sendSync('desktop:info') as DesktopInfo;

// -- secrets -----------------------------------------------------------------
const loaded = ipcRenderer.sendSync('secrets:load') as { available: boolean; values: Record<string, string> };
const mirror = new Map<string, string>(Object.entries(loaded.values));
const secrets: DesktopSecrets = {
  available: loaded.available,
  get: (key) => mirror.get(key) ?? null,
  set: (key, value) => { mirror.set(key, value); ipcRenderer.send('secrets:set', key, value); },
  delete: (key) => { mirror.delete(key); ipcRenderer.send('secrets:delete', key); },
};

// -- deep links --------------------------------------------------------------
// Links that arrive before the app registers its listener are kept and
// replayed to the first one, so a cold-start `flow://` link is never lost.
const linkListeners = new Set<(url: string) => void>();
const queuedLinks: string[] = [];
ipcRenderer.on('links:deepLink', (_event, url: unknown) => {
  if (typeof url !== 'string') return;
  if (linkListeners.size === 0) { queuedLinks.push(url); return; }
  for (const listener of linkListeners) listener(url);
});
const links: DesktopLinks = {
  openExternal: (url) => { if (typeof url === 'string') ipcRenderer.send('links:openExternal', url); },
  onDeepLink: (listener) => {
    linkListeners.add(listener);
    for (const url of queuedLinks.splice(0)) listener(url);
    return () => { linkListeners.delete(listener); };
  },
};

// -- window ------------------------------------------------------------------
let focused = ipcRenderer.sendSync('window:isFocused') as boolean;
const focusListeners = new Set<(focused: boolean) => void>();
ipcRenderer.on('window:focus', (_event, value: unknown) => {
  focused = value === true;
  for (const listener of focusListeners) listener(focused);
});
const win: DesktopWindow = {
  isFocused: () => focused,
  onFocusChange: (listener) => { focusListeners.add(listener); return () => { focusListeners.delete(listener); }; },
  setTitle: (title) => { if (typeof title === 'string') ipcRenderer.send('window:setTitle', title); },
};

// -- zoom --------------------------------------------------------------------
const zoom: DesktopZoom = {
  get: () => ipcRenderer.sendSync('zoom:get') as number,
  set: (level) => { if (typeof level === 'number') ipcRenderer.send('zoom:set', level); },
};

const bridge: FlowDesktopBridge = { info, secrets, links, window: win, zoom };
contextBridge.exposeInMainWorld('flowDesktop', bridge);
