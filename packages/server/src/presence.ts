// Single-node presence bookkeeping (phase1.md §3). Extracted from the gateway
// in phase 2 so the notification service can resolve <!here> to currently-online
// channel members without importing gateway internals. The local maps stay
// authoritative while the deployment is one process (see phase 4 Appendix A for
// the scale-triggered distributed design).

/** userId -> open socket count */
export const online = new Map<string, number>();

export function isOnline(userId: string): boolean {
  return (online.get(userId) ?? 0) > 0;
}
