// Channel activity indicators (#137) — the small spinner an agent turns on at
// the end of a channel's sidebar row while it works on a turn.
//
// Transient by design, like presence (../presence.ts): this is in-memory state,
// never a DB column. A spinner is a claim about *right now*, and the failure
// mode that matters is a run crashing mid-turn and leaving a channel spinning
// forever. Three independent things clear it, so no single failure can:
//   1. the setter clears it explicitly (the bridge does, including error paths),
//   2. the entry expires — every set carries a TTL the setter must refresh,
//   3. the setter's last socket closes (see gateway/index.ts).
// Rebooting the server clears everything, which is the correct answer too.
//
// Single-node, same as presence: the local map is authoritative while the
// deployment is one process. A multi-node deployment needs this in Redis with
// the same TTL semantics — the expiry is what makes that port straightforward.
import type { ChannelIndicatorState } from '@flow/shared';

interface Entry {
  state: ChannelIndicatorState;
  workspaceId: string;
  /** epoch ms; the entry is dead at or after this instant */
  expiresAt: number;
}

/** channelId -> userId -> entry. Per-setter, so one agent clearing its own
 * indicator can't switch off another agent still working in the same channel. */
const byChannel = new Map<string, Map<string, Entry>>();

/** Default lifetime of a set that is never refreshed. Comfortably longer than
 * the bridge's refresh interval, short enough that an abandoned spinner is a
 * blip rather than a permanent lie. */
export const DEFAULT_TTL_MS = 90_000;

/** Drop this channel's dead entries; returns the live ones (or undefined). */
function prune(channelId: string, now: number): Map<string, Entry> | undefined {
  const users = byChannel.get(channelId);
  if (!users) return undefined;
  for (const [userId, e] of users) if (e.expiresAt <= now) users.delete(userId);
  if (users.size === 0) {
    byChannel.delete(channelId);
    return undefined;
  }
  return users;
}

/** The channel's aggregate indicator — what clients render. Any live setter
 * means the row spins; several agents at once still show one spinner. */
export function channelIndicator(channelId: string, now = Date.now()): ChannelIndicatorState | null {
  const users = prune(channelId, now);
  if (!users) return null;
  for (const e of users.values()) return e.state;
  return null;
}

/** Aggregate state for many channels at once (the channel-list overlay). Only
 * channels with a live indicator appear in the returned map. */
export function channelIndicators(channelIds: string[], now = Date.now()): Map<string, ChannelIndicatorState> {
  const out = new Map<string, ChannelIndicatorState>();
  for (const id of channelIds) {
    const state = channelIndicator(id, now);
    if (state) out.set(id, state);
  }
  return out;
}

/**
 * Set (or refresh) one user's indicator in a channel. Returns the channel's
 * aggregate before and after, so the caller can publish an event only when the
 * visible state actually changed — a refresh every 30s must not spam the bus.
 */
export function setIndicator(
  channelId: string,
  workspaceId: string,
  userId: string,
  state: ChannelIndicatorState,
  ttlMs = DEFAULT_TTL_MS,
  now = Date.now(),
): { before: ChannelIndicatorState | null; after: ChannelIndicatorState | null } {
  const before = channelIndicator(channelId, now);
  let users = byChannel.get(channelId);
  if (!users) {
    users = new Map();
    byChannel.set(channelId, users);
  }
  users.set(userId, { state, workspaceId, expiresAt: now + ttlMs });
  return { before, after: channelIndicator(channelId, now) };
}

/** Clear one user's indicator in a channel (no-op if they had none). */
export function clearIndicator(
  channelId: string,
  userId: string,
  now = Date.now(),
): { before: ChannelIndicatorState | null; after: ChannelIndicatorState | null } {
  const before = channelIndicator(channelId, now);
  byChannel.get(channelId)?.delete(userId);
  if (byChannel.get(channelId)?.size === 0) byChannel.delete(channelId);
  return { before, after: channelIndicator(channelId, now) };
}

export interface ChannelRef {
  channelId: string;
  workspaceId: string;
}

/** Clear every indicator this user set — the disconnect path. Returns the
 * channels whose aggregate went quiet as a result (nothing to publish for a
 * channel where another agent is still working). */
export function clearIndicatorsForUser(userId: string, now = Date.now()): ChannelRef[] {
  const cleared: ChannelRef[] = [];
  for (const [channelId, users] of [...byChannel]) {
    const entry = users.get(userId);
    if (!entry) continue;
    const { before, after } = clearIndicator(channelId, userId, now);
    if (before !== null && after === null) cleared.push({ channelId, workspaceId: entry.workspaceId });
  }
  return cleared;
}

/** Drop expired entries everywhere; returns the channels that just went quiet
 * so the sweeper can tell clients (nothing else would — an expiry has no
 * request behind it). */
export function sweepExpired(now = Date.now()): ChannelRef[] {
  const quieted: ChannelRef[] = [];
  for (const [channelId, users] of [...byChannel]) {
    const workspaceId = [...users.values()][0]?.workspaceId;
    if (!workspaceId) continue; // empty map — nothing was showing
    prune(channelId, now);
    // the channel key survives iff at least one entry is still live
    if (!byChannel.has(channelId)) quieted.push({ channelId, workspaceId });
  }
  return quieted;
}

/** Tests only: forget everything. */
export function resetIndicators(): void {
  byChannel.clear();
}
