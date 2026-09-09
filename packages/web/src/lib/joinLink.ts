// Persistent workspace join links (issue #85). The shared URL is
// /join/<workspace-slug>/<token>: the slug is there so the link reads as the
// workspace it joins, but only the token identifies it server-side — a stale
// slug in a copied link still works.
const JOIN_PATH_RE = /^\/join\/[a-z0-9-]{3,40}\/([A-Za-z0-9_-]{16,128})\/?$/i;

/** The token in a join-link pathname, or null if this isn't one. */
export function parseJoinPath(pathname: string): string | null {
  return JOIN_PATH_RE.exec(pathname)?.[1] ?? null;
}

/** The pre-multi-server key, and still the one the migrated default connection
 * uses. A second connection passes its own scoped key: a join token is minted
 * by one server and means nothing on another. */
export const PENDING_JOIN_KEY = 'flow.pendingJoinLink';

/**
 * How long a stashed token stays live. The stash exists so a join link
 * survives the register→confirm-email→sign-in round trip, which takes minutes,
 * not days — and since the token now drives a full-screen join page, a stale
 * one left by someone who wandered off would hijack their next visit. A day is
 * far longer than the round trip and short enough that it never does.
 */
const STASH_TTL_MS = 24 * 60 * 60 * 1000;

/** Hold a join token across the sign-in round trip, stamped so it can expire. */
export function stashJoinToken(token: string, now = Date.now(), key = PENDING_JOIN_KEY): void {
  localStorage.setItem(key, JSON.stringify({ token, at: now }));
}

export function clearJoinToken(key = PENDING_JOIN_KEY): void {
  localStorage.removeItem(key);
}

/**
 * The stashed token, or null when there is none / it has expired. An expired
 * or unreadable stash is dropped on read, so a bad value can't wedge the app
 * on every load. A bare string is the pre-expiry format: honour it once so
 * anyone mid-flow across the deploy still lands in their workspace.
 */
export function readJoinToken(now = Date.now(), key = PENDING_JOIN_KEY): string | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  if (!raw.startsWith('{')) return raw;
  let parsed: { token?: unknown; at?: unknown };
  try {
    parsed = JSON.parse(raw) as { token?: unknown; at?: unknown };
  } catch {
    clearJoinToken(key);
    return null;
  }
  const { token, at } = parsed;
  if (typeof token !== 'string' || typeof at !== 'number' || now - at > STASH_TTL_MS) {
    clearJoinToken(key);
    return null;
  }
  return token;
}
