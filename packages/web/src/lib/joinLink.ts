// Persistent workspace join links (issue #85). The shared URL is
// /join/<workspace-slug>/<token>: the slug is there so the link reads as the
// workspace it joins, but only the token identifies it server-side — a stale
// slug in a copied link still works.
const JOIN_PATH_RE = /^\/join\/[a-z0-9-]{3,40}\/([A-Za-z0-9_-]{16,128})\/?$/i;

/** The token in a join-link pathname, or null if this isn't one. */
export function parseJoinPath(pathname: string): string | null {
  return JOIN_PATH_RE.exec(pathname)?.[1] ?? null;
}
