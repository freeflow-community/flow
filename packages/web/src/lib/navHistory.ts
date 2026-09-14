/**
 * Channel visit history (issue #386) — browser-style back/forward over the
 * main-pane views this session has opened.
 *
 * A plain value, not a mutable store: the header buttons need to re-render the
 * moment their enabled-ness changes, so App holds it in state and every
 * operation returns a new history (or the same one, when nothing moved).
 *
 * Entries are whatever identifies a main-pane view — for the web client that
 * is the selection's `channelId`, sentinels for Activity/Admin included.
 * In-memory and per-workspace: cleared on workspace switch and sign-out.
 */
export interface NavHistory {
  /** Oldest → newest. Everything after `index` is the forward branch. */
  readonly entries: readonly string[];
  /** Position of the currently-shown view, or -1 for a fresh session. */
  readonly index: number;
}

/** How many visits we keep. Deep enough that back never runs dry in practice. */
const LIMIT = 50;

export const emptyNavHistory: NavHistory = { entries: [], index: -1 };

/**
 * Record a visit. Re-opening the view you are already on is not a visit, and
 * navigating somewhere new after going back discards the forward branch —
 * both exactly as a browser behaves.
 */
export function pushNav(h: NavHistory, id: string): NavHistory {
  if (h.entries[h.index] === id) return h;
  const entries = [...h.entries.slice(0, h.index + 1), id].slice(-LIMIT);
  return { entries, index: entries.length - 1 };
}

export function canGoBack(h: NavHistory): boolean {
  return h.index > 0;
}

export function canGoForward(h: NavHistory): boolean {
  return h.index >= 0 && h.index < h.entries.length - 1;
}

/** The entry one step back, or null when there is nothing behind us. */
export function backTarget(h: NavHistory): string | null {
  return canGoBack(h) ? h.entries[h.index - 1]! : null;
}

/** The entry one step forward, or null when the forward branch is empty. */
export function forwardTarget(h: NavHistory): string | null {
  return canGoForward(h) ? h.entries[h.index + 1]! : null;
}

/** Move the cursor without touching the entries (what back/forward do). */
export function stepNav(h: NavHistory, delta: -1 | 1): NavHistory {
  const next = h.index + delta;
  if (next < 0 || next >= h.entries.length) return h;
  return { entries: h.entries, index: next };
}

/**
 * Drop every trace of a view that is gone (channel left, archived, deleted).
 * Leaving dead entries in would make back land on a blank pane; removing them
 * keeps the cursor pointing at the same visit it was on.
 */
export function forgetNav(h: NavHistory, id: string): NavHistory {
  if (!h.entries.includes(id)) return h;
  const entries: string[] = [];
  let index = h.index;
  h.entries.forEach((e, i) => {
    if (e === id) {
      if (i <= h.index) index -= 1;
    } else {
      entries.push(e);
    }
  });
  return { entries, index: Math.min(Math.max(index, entries.length ? 0 : -1), entries.length - 1) };
}
