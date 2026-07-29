// Live patches to the cached channel list. Kept out of the event switch in
// Main.tsx so the reducer half is testable on its own.
import type { ChannelDTO, ChannelIndicatorData } from '@flow/shared';

/**
 * Apply a `channel.indicator` event (#137) to the cached list. Returns the same
 * array when nothing changed, so React Query keeps the old reference and the
 * sidebar doesn't re-render on a no-op — the server only publishes real
 * transitions, but an event for a channel this client hasn't loaded (or one
 * that's already in that state) still arrives.
 */
export function applyIndicator(channels: ChannelDTO[], data: ChannelIndicatorData): ChannelDTO[] {
  const cur = channels.find((c) => c.id === data.channelId);
  if (!cur || (cur.indicator ?? null) === data.state) return channels;
  return channels.map((c) => (c.id === data.channelId ? { ...c, indicator: data.state } : c));
}
