/**
 * Per-channel memory of which thread was open (issue #89).
 *
 * The open thread lives in a single `threadRootId` selection field, so
 * switching channels used to drop it on the floor. This remembers the thread
 * each channel had open, so leaving a channel and coming back restores it.
 * Purely in-memory and per-workspace — cleared on workspace switch/sign-out,
 * and nothing survives a reload (like the rest of the selection state).
 */
export interface ThreadMemory {
  /** Record (or, for a null root, forget) the thread open in a channel. */
  remember(channelId: string | null, threadRootId: string | null): void;
  /** The thread that was open in a channel, if any. */
  recall(channelId: string | null): string | null;
  /** Drop a channel's memory — it was left, archived, or is gone. */
  forget(channelId: string): void;
  /** Drop everything (workspace switch, sign-out). */
  clear(): void;
}

export function createThreadMemory(): ThreadMemory {
  const byChannel = new Map<string, string>();
  return {
    remember(channelId, threadRootId) {
      if (!channelId) return;
      if (threadRootId) byChannel.set(channelId, threadRootId);
      else byChannel.delete(channelId);
    },
    recall(channelId) {
      return (channelId && byChannel.get(channelId)) || null;
    },
    forget(channelId) {
      byChannel.delete(channelId);
    },
    clear() {
      byChannel.clear();
    },
  };
}
