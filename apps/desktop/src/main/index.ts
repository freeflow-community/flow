// Flow desktop shell — main process (docs/specs/desktop-electron.md, M2).
//
// One window that serves the bundled web client from `app://flow`, a typed
// bridge for the renderer (see ../preload), `flow://` links on every
// platform, a real application menu, credentials in the OS store, and the
// profile/server conventions the macOS app already has.
import path from 'node:path';
import { app, BrowserWindow, ipcMain, nativeTheme, session, shell } from 'electron';
import { DESKTOP_ORIGIN, type DesktopInfo, type DesktopNotification } from '@flow/shared';
import { APP_SCHEME, isAppUrl, registerAppScheme, serveWebClient } from './appProtocol.js';
import { setBadge } from './badge.js';
import { Notifier } from './notifications.js';
import { loadPrefs } from './prefs.js';
import { installTray, setTrayUnread, traySupported } from './tray.js';
import { defaultServerOrigin, distRoot, profileName, webRoot } from './config.js';
import { installContextMenu } from './contextMenu.js';
import { deepLinkFromArgv, isFlowLink, isOpenableExternally } from './lib/argv.js';
import { applyZoom, installMenu, loadZoomLevel } from './menu.js';
import { SecretStore } from './secrets.js';
import { initialBounds, loadWindowState, trackWindowState } from './windowState.js';

const profile = profileName();

// ---- before ready ----------------------------------------------------------

// The Swift app keeps its state under "Flow<scope>"; a distinct directory keeps
// the two from ever reading each other's files, and a profile gets its own.
app.setName('Flow');
app.setPath('userData', path.join(app.getPath('appData'), profile ? `Flow Desktop-${profile}` : 'Flow Desktop'));

registerAppScheme();

// One process per profile: a second launch (a `flow://` link on Windows or
// Linux opens the executable again) hands its argument to the running app.
if (!app.requestSingleInstanceLock({ profile })) {
  app.quit();
}

// Register the URL scheme. In development the OS needs the executable and
// the script path to launch us; a packaged app registers itself.
if (app.isPackaged) app.setAsDefaultProtocolClient('flow');
else if (process.argv[1]) app.setAsDefaultProtocolClient('flow', process.execPath, [path.resolve(process.argv[1])]);

// ---- state -----------------------------------------------------------------

const secrets = new SecretStore();
/** Test seam (`FLOW_DESKTOP_TEST_HOOKS=1`): banners are recorded, not shown,
 * and a test can click one by id through `globalThis.__flowDesktopTest`. */
const testHooks = process.env.FLOW_DESKTOP_TEST_HOOKS === '1';
const recorded: DesktopNotification[] = [];
const notifier = new Notifier(testHooks ? { record: (n) => { recorded.push(n); } } : {});
if (testHooks) {
  (globalThis as { __flowDesktopTest?: unknown }).__flowDesktopTest = {
    notifications: recorded,
    click: (id: string) => notifier.click(id),
  };
}
/** Set once the app is really quitting, so close-to-tray lets the window go. */
let quitting = false;
let mainWindow: BrowserWindow | null = null;
/** Links that arrived before the renderer could take them (cold start). */
const pendingLinks: string[] = [];
let rendererReady = false;

function info(): DesktopInfo {
  return {
    platform: process.platform as DesktopInfo['platform'],
    version: app.isPackaged ? app.getVersion() : '0.0.0',
    profile,
    defaultServerOrigin: defaultServerOrigin(),
  };
}

function deliverDeepLink(url: string): void {
  if (!isFlowLink(url)) return;
  showMainWindow();
  if (mainWindow && rendererReady) mainWindow.webContents.send('links:deepLink', url);
  else pendingLinks.push(url);
}

function showMainWindow(): void {
  if (!mainWindow) { createWindow(); return; }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// macOS hands links to the running app (or the one it just launched).
app.on('open-url', (event, url) => { event.preventDefault(); deliverDeepLink(url); });
// Windows and Linux relaunch the executable with the link as an argument.
app.on('second-instance', (_event, argv) => {
  const link = deepLinkFromArgv(argv);
  if (link) deliverDeepLink(link);
  else showMainWindow();
});

// ---- window ----------------------------------------------------------------

function createWindow(): BrowserWindow {
  const saved = loadWindowState();
  const win = new BrowserWindow({
    ...initialBounds(saved),
    minWidth: 640,
    minHeight: 480,
    show: false,
    title: 'Flow',
    autoHideMenuBar: process.platform !== 'darwin',
    // A normal title bar: the web client's rail starts at the top-left,
    // where macOS puts the traffic lights, so an inset bar overlaps it.
    titleBarStyle: 'default',
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(distRoot, 'preload', 'index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
      // Zoom is the shell's, driven from the menu; pinch/Ctrl+wheel would
      // otherwise fight it.
      zoomFactor: 1,
    },
  });
  mainWindow = win;
  rendererReady = false;
  if (saved?.maximized) win.maximize();
  trackWindowState(win);
  installContextMenu(win);

  // Any new window request — target=_blank, window.open — is a link for the
  // system browser. Nothing else may open a second Electron window (M4 adds
  // mini-app windows through the bridge, never through window.open).
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isOpenableExternally(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  // The document itself stays on the bundled client.
  win.webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    if (isOpenableExternally(url)) void shell.openExternal(url);
  });
  win.webContents.on('did-finish-load', () => {
    win.webContents.setZoomLevel(loadZoomLevel());
    rendererReady = true;
    for (const link of pendingLinks.splice(0)) win.webContents.send('links:deepLink', link);
  });
  win.on('focus', () => win.webContents.send('window:focus', true));
  win.on('blur', () => win.webContents.send('window:focus', false));
  win.once('ready-to-show', () => win.show());
  // Windows and Linux: closing hides to the tray so banners and the badge
  // keep working, unless the person turned that off in the tray menu.
  win.on('close', (event) => {
    if (quitting || !traySupported() || loadPrefs().quitOnClose === true) return;
    event.preventDefault();
    win.hide();
  });
  win.on('closed', () => { if (mainWindow === win) mainWindow = null; });
  // Banner clicks reach whichever renderer is current; a click with no
  // renderer yet is held by the notifier until one registers.
  notifier.setClickListener((routing) => { showMainWindow(); win.webContents.send('notifications:click', routing); });

  void win.loadURL(`${DESKTOP_ORIGIN}/`);
  return win;
}

// ---- IPC (the preload's half is ../preload/index.cts) ----------------------

function installIpc(): void {
  ipcMain.on('desktop:info', (event) => { event.returnValue = info(); });
  ipcMain.on('secrets:load', (event) => { event.returnValue = { available: secrets.available, values: secrets.load() }; });
  ipcMain.on('secrets:set', (_event, key: unknown, value: unknown) => {
    if (typeof key === 'string' && typeof value === 'string') secrets.set(key, value);
  });
  ipcMain.on('secrets:delete', (_event, key: unknown) => { if (typeof key === 'string') secrets.delete(key); });
  ipcMain.on('links:openExternal', (_event, url: unknown) => {
    if (typeof url === 'string' && isOpenableExternally(url)) void shell.openExternal(url);
  });
  ipcMain.on('window:isFocused', (event) => {
    event.returnValue = BrowserWindow.fromWebContents(event.sender)?.isFocused() ?? false;
  });
  ipcMain.on('window:setTitle', (event, title: unknown) => {
    if (typeof title === 'string') BrowserWindow.fromWebContents(event.sender)?.setTitle(title.slice(0, 200) || 'Flow');
  });
  ipcMain.on('zoom:get', (event) => { event.returnValue = event.sender.getZoomLevel(); });
  ipcMain.on('zoom:set', (_event, level: unknown) => { if (typeof level === 'number') applyZoom(level); });
  ipcMain.on('notifications:show', (_event, raw: unknown) => {
    const n = raw as Partial<DesktopNotification> | null;
    if (!n || typeof n.id !== 'string' || typeof n.title !== 'string' || typeof n.body !== 'string' || !n.routing) return;
    const r = n.routing as Partial<DesktopNotification['routing']>;
    if (typeof r.routingId !== 'string' || typeof r.workspaceId !== 'string' || typeof r.channelId !== 'string' || typeof r.messageId !== 'string' || typeof r.notificationId !== 'string') return;
    notifier.show({
      id: n.id, title: n.title.slice(0, 200), body: n.body.slice(0, 1000), silent: n.silent === true,
      ...(typeof n.subtitle === 'string' ? { subtitle: n.subtitle.slice(0, 120) } : {}),
      routing: { routingId: r.routingId, workspaceId: r.workspaceId, channelId: r.channelId, messageId: r.messageId,
        threadRootId: typeof r.threadRootId === 'string' ? r.threadRootId : null, notificationId: r.notificationId },
    });
  });
  ipcMain.on('notifications:clearDelivered', (_event, routingId: unknown) => { if (typeof routingId === 'string') notifier.clearDelivered(routingId); });
  ipcMain.on('badge:set', (_event, count: unknown) => {
    if (typeof count !== 'number' || !Number.isFinite(count)) return;
    setBadge(count);
    setTrayUnread(Math.max(0, Math.floor(count)));
  });
}

// ---- session hardening -----------------------------------------------------

function hardenSession(): void {
  const s = session.defaultSession;
  const allowed = new Set(['media', 'notifications', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen', 'display-capture']);
  s.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(isAppUrl(webContents.getURL()) && allowed.has(permission));
  });
  s.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    return requestingOrigin.startsWith(`${APP_SCHEME}://`) && allowed.has(permission);
  });
  // The web client only ever talks to Flow servers and connectors it knows;
  // there is no reason for the renderer to load anything else as a document.
  s.webRequest.onBeforeRequest({ urls: ['file://*/*'] }, (_details, callback) => callback({ cancel: true }));
}

// ---- lifecycle -------------------------------------------------------------

void app.whenReady().then(() => {
  // The web client renders light today, as the macOS app forces; follow it.
  nativeTheme.themeSource = 'light';
  hardenSession();
  serveWebClient(webRoot());
  installIpc();
  installMenu({ helpUrl: `${defaultServerOrigin()}/` });
  installTray({ showWindow: showMainWindow, quit: () => { quitting = true; app.quit(); } });
  createWindow();
  const link = deepLinkFromArgv(process.argv);
  if (link) deliverDeepLink(link);
});

app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); else showMainWindow(); });

app.on('before-quit', () => { quitting = true; });

app.on('window-all-closed', () => {
  // macOS keeps running in the Dock like the native app. On Windows and
  // Linux the window normally hides to the tray instead of closing; when it
  // really closed (quit-on-close is on, or no tray), the app quits.
  if (process.platform !== 'darwin') app.quit();
});

app.on('web-contents-created', (_event, contents) => {
  // Belt and braces for any web contents the shell did not create itself.
  contents.on('will-attach-webview', (event) => event.preventDefault());
});
