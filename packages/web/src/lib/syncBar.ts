// The reconnect/catch-up bar's timing (#234) — the web half of the rule the
// native clients implement in Support/SyncBar.swift. Same two numbers, so a
// reconnect looks the same wherever you are watching it.
import { useEffect, useRef, useState } from 'react';

/** Syncing must last this long before anything is drawn. */
export const SHOW_DELAY_MS = 250;
/** Once drawn, the bar stays at least this long. */
export const MIN_VISIBLE_MS = 500;

export interface SyncBarTimerOptions {
  showDelay?: number;
  minVisible?: number;
  now?: () => number;
}

/**
 * "Is the app syncing" -> "should a bar be on screen", with a show-delay and a
 * minimum visible duration. Both exist for the same reason: a reconnect that
 * resolves in 200ms should draw nothing, and one that resolves in 300ms should
 * not flash a bar for 50ms.
 *
 * Framework-free so it can be tested without a DOM — the hook below is a thin
 * wrapper. Mirrors `SyncIndicator` in the Swift core.
 */
export class SyncBarTimer {
  private visible = false;
  private pending: ReturnType<typeof setTimeout> | null = null;
  private shownAt: number | null = null;
  private readonly showDelay: number;
  private readonly minVisible: number;
  private readonly now: () => number;

  constructor(
    private readonly onChange: (visible: boolean) => void,
    { showDelay = SHOW_DELAY_MS, minVisible = MIN_VISIBLE_MS, now = () => performance.now() }: SyncBarTimerOptions = {},
  ) {
    this.showDelay = showDelay;
    this.minVisible = minVisible;
    this.now = now;
  }

  update(syncing: boolean): void {
    this.clearPending();
    if (syncing) {
      if (this.visible) return; // already up — and a pending hide just got cancelled
      this.pending = setTimeout(() => {
        this.pending = null;
        this.shownAt = this.now();
        this.set(true);
      }, this.showDelay);
      return;
    }
    if (!this.visible) return; // never made it on screen — nothing to hide
    const elapsed = this.now() - (this.shownAt ?? 0);
    const remaining = Math.max(0, this.minVisible - elapsed);
    this.pending = setTimeout(() => {
      this.pending = null;
      this.shownAt = null;
      this.set(false);
    }, remaining);
  }

  dispose(): void {
    this.clearPending();
  }

  private clearPending(): void {
    if (this.pending !== null) clearTimeout(this.pending);
    this.pending = null;
  }

  private set(visible: boolean): void {
    this.visible = visible;
    this.onChange(visible);
  }
}

/** React binding for `SyncBarTimer`: true while the bar should be on screen. */
export function useSyncBar(syncing: boolean, options?: SyncBarTimerOptions): boolean {
  const [visible, setVisible] = useState(false);
  const timer = useRef<SyncBarTimer | null>(null);
  if (timer.current === null) timer.current = new SyncBarTimer(setVisible, options);

  useEffect(() => {
    timer.current?.update(syncing);
  }, [syncing]);

  useEffect(() => () => timer.current?.dispose(), []);

  return visible;
}
