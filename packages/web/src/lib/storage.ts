// Where the client keeps the few values that must outlive a page load and
// that a packaged client keeps somewhere other than localStorage: the session
// token, and the API base a first-run server picker chooses. On web this is
// localStorage, unchanged. A Capacitor shell (docs/design/ANDROID.md, phase 0)
// swaps in secure storage with `setStore`.
//
// The interface is synchronous on purpose — every API call reads the token
// inline, and making that async would ripple through every caller. A native
// store that is itself async hydrates an in-memory copy once at startup,
// before React mounts, and writes through on every `set`.
//
// Everything else the client remembers (active workspace, collapsed groups,
// dismissed banners) is a UI preference and stays on localStorage directly.

export interface KeyValueStore {
  get(key: string): string | null;
  /** `null` removes the key. */
  set(key: string, value: string | null): void;
}

// `localStorage` is absent outside a browser (vitest's node environment, SSR
// tooling) — or, on Node ≥ 22, present as a method-less stub until the process
// opts in to Web Storage — so probe the method rather than the global, and
// treat either case as an empty store instead of throwing.
function browserStorage(): Storage | null {
  return typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function'
    ? localStorage
    : null;
}

const localStorageStore: KeyValueStore = {
  get(key) {
    return browserStorage()?.getItem(key) ?? null;
  },
  set(key, value) {
    const ls = browserStorage();
    if (!ls) return;
    if (value === null) ls.removeItem(key);
    else ls.setItem(key, value);
  },
};

let current: KeyValueStore = localStorageStore;

export function store(): KeyValueStore {
  return current;
}

/** Replace the backing store. Call before anything reads the token — in
 * practice, before React mounts. Pass nothing to restore localStorage. */
export function setStore(next: KeyValueStore = localStorageStore): void {
  current = next;
}
