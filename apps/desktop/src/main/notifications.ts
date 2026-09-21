// OS banners (docs/specs/desktop-electron.md, "Notifications"). The shell
// decides nothing about *what* notifies — the web client and the server do —
// it only shows what it is handed and routes the click back. One banner per
// notification id, however many windows ask (M4), and a click that lands
// before the renderer can take it is kept until it can.
import { Notification } from 'electron';
import type { DesktopNotification, NotificationRouting } from '@flow/shared';

/** How long an id is remembered for de-duplication. */
const DEDUP_MS = 60_000;

export interface NotifierHooks {
  /** Test seam: record instead of showing, and let a test click by id. */
  record?: (n: DesktopNotification) => void;
}

export class Notifier {
  private shown = new Map<string, { at: number; notification: Notification | null; routingId: string }>();
  private clickListener: ((routing: NotificationRouting) => void) | null = null;
  private pendingClicks: NotificationRouting[] = [];
  private routingById = new Map<string, NotificationRouting>();

  constructor(private hooks: NotifierHooks = {}) {}

  static get supported(): boolean {
    return Notification.isSupported();
  }

  show(n: DesktopNotification): void {
    const now = Date.now();
    for (const [id, entry] of this.shown) if (now - entry.at > DEDUP_MS) this.shown.delete(id);
    if (this.shown.has(n.id)) return;
    this.routingById.set(n.id, n.routing);
    if (this.hooks.record) {
      this.hooks.record(n);
      this.shown.set(n.id, { at: now, notification: null, routingId: n.routing.routingId });
      return;
    }
    if (!Notification.isSupported()) return;
    const notification = new Notification({
      title: process.platform === 'darwin' || !n.subtitle ? n.title : `${n.title} · ${n.subtitle}`,
      ...(process.platform === 'darwin' && n.subtitle ? { subtitle: n.subtitle } : {}),
      body: n.body,
      silent: n.silent,
    });
    notification.on('click', () => this.click(n.id));
    // macOS refuses an ad-hoc-signed app (UNErrorDomain 1); say so in the
    // log instead of failing silently — see scripts/sign-dev-electron.sh.
    notification.on('failed', (_event, error) => console.error(`[flow-desktop] banner failed: ${error}`));
    if (process.env.FLOW_DESKTOP_DEBUG === '1') notification.on('show', () => console.log(`[flow-desktop] banner shown ${n.id}`));
    notification.on('close', () => { const e = this.shown.get(n.id); if (e) e.notification = null; });
    this.shown.set(n.id, { at: now, notification, routingId: n.routing.routingId });
    notification.show();
  }

  /** Deliver a click to the renderer, or hold it until one listens. */
  click(id: string): void {
    const routing = this.routingById.get(id);
    if (!routing) return;
    if (this.clickListener) this.clickListener(routing);
    else this.pendingClicks.push(routing);
  }

  /** The renderer (through IPC) takes clicks from here; replays what waited. */
  setClickListener(listener: ((routing: NotificationRouting) => void) | null): void {
    this.clickListener = listener;
    if (listener) for (const routing of this.pendingClicks.splice(0)) listener(routing);
  }

  /** Take down every banner still up for a connection (sign-out). */
  clearDelivered(routingId: string): void {
    for (const [id, entry] of this.shown) {
      if (entry.routingId !== routingId) continue;
      entry.notification?.close();
      this.shown.delete(id);
      this.routingById.delete(id);
    }
  }
}
