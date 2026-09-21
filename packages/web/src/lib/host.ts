// The host seam (docs/specs/desktop-electron.md, "Bridge contract").
//
// The web client runs in two hosts: a browser tab, and the desktop shell's
// renderer, where the preload exposes `window.flowDesktop`. Everything the
// shell can do that a tab cannot — keep a credential in the OS store, open
// the system browser and get a `flow://` link back, know whether the window
// is focused — is reached through `getHost()`. The browser fallback has the
// same shape, so call sites never branch on where they run; they ask the host.
//
// `isDesktop()` exists for the few places whose *product* behaviour differs
// (sign-in goes through the system browser, the "open the desktop app" pitch
// is pointless inside the desktop app), not for capability checks.
import type { DesktopLinks, DesktopSecrets, DesktopWindow, DesktopZoom, FlowDesktopBridge } from '@flow/shared';

export interface FlowHost {
  readonly isDesktop: boolean;
  readonly platform: 'browser' | 'darwin' | 'win32' | 'linux';
  /** The Flow server this client is built for, or null when the page's own
   * origin is the server (the browser case). */
  readonly defaultServerOrigin: string | null;
  /** `FLOW_PROFILE` on desktop, null in a browser. */
  readonly profile: string | null;
  /** May this client talk plaintext to a loopback server? The shell says yes
   * when its baked default is one (a development build); a browser decides
   * from its own page origin (see `serverOrigin.ts`). */
  readonly allowsInsecureLoopback: boolean;
  readonly secrets: DesktopSecrets;
  readonly links: DesktopLinks;
  readonly window: DesktopWindow;
  readonly zoom: DesktopZoom;
}

function browserSecrets(): DesktopSecrets {
  return {
    available: true,
    get: (key) => localStorage.getItem(key),
    set: (key, value) => localStorage.setItem(key, value),
    delete: (key) => localStorage.removeItem(key),
  };
}

function browserLinks(): DesktopLinks {
  return {
    openExternal: (url) => { window.open(url, '_blank', 'noopener'); },
    // A browser tab is never handed a flow:// link; the OS routes those to
    // the installed app.
    onDeepLink: () => () => {},
  };
}

function browserWindow(): DesktopWindow {
  return {
    isFocused: () => typeof document !== 'undefined' && document.hasFocus(),
    onFocusChange: (listener) => {
      const focus = () => listener(true);
      const blur = () => listener(false);
      window.addEventListener('focus', focus);
      window.addEventListener('blur', blur);
      return () => { window.removeEventListener('focus', focus); window.removeEventListener('blur', blur); };
    },
    setTitle: (title) => { if (typeof document !== 'undefined') document.title = title; },
  };
}

const browserZoom: DesktopZoom = { get: () => 0, set: () => {} };

function browserHost(): FlowHost {
  return {
    isDesktop: false,
    platform: 'browser',
    defaultServerOrigin: null,
    profile: null,
    allowsInsecureLoopback: false,
    secrets: browserSecrets(),
    links: browserLinks(),
    window: browserWindow(),
    zoom: browserZoom,
  };
}

function desktopHost(bridge: FlowDesktopBridge): FlowHost {
  const origin = bridge.info.defaultServerOrigin;
  return {
    isDesktop: true,
    platform: bridge.info.platform,
    defaultServerOrigin: origin,
    profile: bridge.info.profile,
    allowsInsecureLoopback: origin.startsWith('http://'),
    secrets: bridge.secrets,
    links: bridge.links,
    window: {
      ...bridge.window,
      // The window title follows the document title in Electron, so the
      // document is what to set; the shell is told too for its own bookkeeping.
      setTitle: (title) => {
        if (typeof document !== 'undefined') document.title = title;
        bridge.window.setTitle(title);
      },
    },
    zoom: bridge.zoom,
  };
}

let current: FlowHost | null = null;

export function getHost(): FlowHost {
  if (current) return current;
  const bridge = typeof window !== 'undefined' ? window.flowDesktop : undefined;
  current = bridge ? desktopHost(bridge) : browserHost();
  return current;
}

export function isDesktop(): boolean {
  return getHost().isDesktop;
}

/** Test seam: install a host, or null to detect again on the next call. */
export function __setHost(host: FlowHost | null): void {
  current = host;
}
