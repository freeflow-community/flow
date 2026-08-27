// Single-node presence bookkeeping (phase1.md §3). Extracted from the gateway
// in phase 2 so the notification service can resolve <!here> to currently-online
// channel members without importing gateway internals. The local maps stay
// authoritative while the deployment is one process (see phase 4 Appendix A for
// the scale-triggered distributed design).
//
// Presence is keyed per **(user, workspace)**, not per user (#364). A user's
// socket carries every workspace they belong to, but the *connection* may only
// serve some of them — an agent bridge runs one process per workspace and
// ignores the rest — so a connection declares which workspaces it is present
// in. Counting per workspace is also what makes multiple connections work: the
// dot stays green while any connection announcing that workspace is alive.
//
// Every connection carries a lastSeen stamp so `sweepStale` can drop entries
// whose close event never arrived (half-open socket, killed process). That is
// the backstop; the socket 'close' handler is the fast path.

interface Connection {
  userId: string;
  /** workspaces this connection announces presence in */
  workspaces: Set<string>;
  lastSeen: number;
}

/** connectionId -> connection */
const connections = new Map<string, Connection>();
/** userId -> workspaceId -> number of live connections present there */
const counts = new Map<string, Map<string, number>>();
/** workspaceId -> userIds currently online in it (index over `counts`) */
const byWorkspace = new Map<string, Set<string>>();

/** Bump the (user, workspace) counter. Returns true if they just came online there. */
function increment(userId: string, workspaceId: string): boolean {
  let perWorkspace = counts.get(userId);
  if (!perWorkspace) counts.set(userId, (perWorkspace = new Map()));
  const next = (perWorkspace.get(workspaceId) ?? 0) + 1;
  perWorkspace.set(workspaceId, next);
  if (next > 1) return false;
  let members = byWorkspace.get(workspaceId);
  if (!members) byWorkspace.set(workspaceId, (members = new Set()));
  members.add(userId);
  return true;
}

/** Drop one from the (user, workspace) counter. Returns true if they just went offline there. */
function decrement(userId: string, workspaceId: string): boolean {
  const perWorkspace = counts.get(userId);
  const next = (perWorkspace?.get(workspaceId) ?? 0) - 1;
  if (!perWorkspace || next > 0) {
    perWorkspace?.set(workspaceId, next);
    return false;
  }
  perWorkspace.delete(workspaceId);
  if (perWorkspace.size === 0) counts.delete(userId);
  const members = byWorkspace.get(workspaceId);
  members?.delete(userId);
  if (members?.size === 0) byWorkspace.delete(workspaceId);
  return true;
}

/**
 * A connection came up. `workspaceIds` is the set it announces presence in.
 * Returns the workspaces where this made the user newly online (publish
 * `presence: online` for exactly those).
 */
export function registerConnection(
  connectionId: string,
  userId: string,
  workspaceIds: Iterable<string>,
  now: number = Date.now(),
): string[] {
  const workspaces = new Set(workspaceIds);
  connections.set(connectionId, { userId, workspaces, lastSeen: now });
  const cameOnline: string[] = [];
  for (const wsId of workspaces) if (increment(userId, wsId)) cameOnline.push(wsId);
  return cameOnline;
}

/** The connection is still alive (any inbound frame, heartbeat pong included). */
export function touchConnection(connectionId: string, now: number = Date.now()): void {
  const conn = connections.get(connectionId);
  if (conn) conn.lastSeen = now;
}

/**
 * The connection went away. Returns the workspaces where the user is now
 * offline (publish `presence: offline` for exactly those).
 */
export function unregisterConnection(connectionId: string): string[] {
  const conn = connections.get(connectionId);
  if (!conn) return [];
  connections.delete(connectionId);
  const wentOffline: string[] = [];
  for (const wsId of conn.workspaces) if (decrement(conn.userId, wsId)) wentOffline.push(wsId);
  return wentOffline;
}

/** This connection now also serves `workspaceId` (a live workspace.joined). */
export function addWorkspace(connectionId: string, workspaceId: string): boolean {
  const conn = connections.get(connectionId);
  if (!conn || conn.workspaces.has(workspaceId)) return false;
  conn.workspaces.add(workspaceId);
  return increment(conn.userId, workspaceId);
}

/** This connection stopped serving `workspaceId` (the user left it). */
export function removeWorkspace(connectionId: string, workspaceId: string): boolean {
  const conn = connections.get(connectionId);
  if (!conn || !conn.workspaces.has(workspaceId)) return false;
  conn.workspaces.delete(workspaceId);
  return decrement(conn.userId, workspaceId);
}

export function isOnline(userId: string, workspaceId: string): boolean {
  return (counts.get(userId)?.get(workspaceId) ?? 0) > 0;
}

/** Everyone currently online in this workspace (for the connect-time snapshot). */
export function onlineUsersIn(workspaceId: string): string[] {
  return [...(byWorkspace.get(workspaceId) ?? [])];
}

/** Does this user hold any live connection at all? (any workspace) */
export function hasAnyConnection(userId: string): boolean {
  return (counts.get(userId)?.size ?? 0) > 0;
}

export interface StaleConnection {
  connectionId: string;
  userId: string;
  /** workspaces the user is now offline in because of this expiry */
  wentOffline: string[];
}

/**
 * TTL backstop: forget connections that haven't been heard from within
 * `ttlMs`. A clean close is handled by `unregisterConnection`; this catches the
 * cases where the close never arrives — a half-open socket, a laptop that slept,
 * a process killed with its FIN lost.
 */
export function sweepStale(ttlMs: number, now: number = Date.now()): StaleConnection[] {
  const stale: StaleConnection[] = [];
  for (const [connectionId, conn] of connections) {
    if (now - conn.lastSeen <= ttlMs) continue;
    stale.push({ connectionId, userId: conn.userId, wentOffline: unregisterConnection(connectionId) });
  }
  return stale;
}

/** Test hook — drop all presence state. */
export function resetPresence(): void {
  connections.clear();
  counts.clear();
  byWorkspace.clear();
}
