// Window bounds restoration, Electron-free so it can be unit-tested.

export interface Rect { x: number; y: number; width: number; height: number }

export interface SavedWindowState extends Rect { maximized: boolean }

export const DEFAULT_SIZE = { width: 1200, height: 800 };
const MIN_SIZE = { width: 640, height: 480 };

/** Parse a saved state file's contents, accepting only a complete record. */
export function parseWindowState(raw: string | null): SavedWindowState | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<SavedWindowState>;
    if (![v.x, v.y, v.width, v.height].every(n => typeof n === 'number' && Number.isFinite(n))) return null;
    return { x: v.x!, y: v.y!, width: v.width!, height: v.height!, maximized: v.maximized === true };
  } catch {
    return null;
  }
}

/** Is enough of the saved rectangle on some display that the person can
 * grab it? A window restored onto a monitor that is no longer attached is
 * the classic way to "lose" an app. */
export function isVisibleOn(rect: Rect, displays: readonly Rect[]): boolean {
  if (rect.width < MIN_SIZE.width || rect.height < MIN_SIZE.height) return false;
  const margin = 64;
  return displays.some(d =>
    rect.x + rect.width - margin > d.x && rect.x + margin < d.x + d.width &&
    rect.y + margin > d.y - margin && rect.y + margin < d.y + d.height,
  );
}

/** The rectangle to open with: the saved one when it is still visible,
 * otherwise a default centred on the primary display. */
export function restoreBounds(saved: SavedWindowState | null, displays: readonly Rect[], primary: Rect): Rect {
  if (saved && isVisibleOn(saved, displays)) {
    return { x: saved.x, y: saved.y, width: saved.width, height: saved.height };
  }
  const width = Math.min(DEFAULT_SIZE.width, primary.width);
  const height = Math.min(DEFAULT_SIZE.height, primary.height);
  return {
    x: Math.round(primary.x + (primary.width - width) / 2),
    y: Math.round(primary.y + (primary.height - height) / 2),
    width,
    height,
  };
}
