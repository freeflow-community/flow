// Distributed presence over NATS (phase 18 M2, design doc §1).
//
// Every ~10s each replica publishes its full local online set on
// `presence.sync.{replicaId}` and absorbs everyone else's into the store's
// remote view; entries expire after ~3 missed beats. Full snapshots, not
// deltas — self-healing by construction. All the *read* merging and the
// event-dedup rule live in PresenceStore (presence.ts); this module is only
// the transport loop plus the one piece that needs coordination:
//
// **Offline-expiry election.** When a replica dies, the offline events for
// its users are never emitted. On expiry, every survivor computes which
// (user, workspace) pairs dropped out of the merged view, but only the
// replica with the lexicographically smallest live replicaId publishes the
// events — a cheap deterministic election. Worst case (the survivors
// disagree about liveness for a beat) is a duplicate offline event, which
// clients already tolerate: presence events are idempotent state, not a
// stream.
//
// NATS outage: publishEvent is fire-and-forget and the subscription just goes
// quiet, so each replica degrades to its local view — exactly the old
// single-node behavior — and the remote entries age out. Fan-out is down
// anyway; presence staleness is not the headline problem.
//
// At `replicas: 1` nothing is ever received and every merged read equals the
// local read: this ships and soaks harmlessly before the flip.
import { randomUUID } from 'node:crypto';
import type { Event } from '@flow/shared';
import {
  publishEvent,
  subjectIndicator,
  subjectPresence,
  subjectPresenceSync,
  subjectPresenceSyncAll,
  subscribeBus,
} from './bus.js';
import { presenceStore, type PresenceStore } from './presence.js';
import {
  applyRemoteIndicators,
  expireRemoteIndicators,
  localIndicatorSnapshot,
  type ChannelRef,
  type RemoteIndicator,
} from './indicators.js';

export const HEARTBEAT_MS = 10_000;
/** three missed beats */
export const EXPIRY_MS = HEARTBEAT_MS * 3;

export interface SyncPayload {
  replicaId: string;
  /** workspaceId -> userIds online there via that replica */
  workspaces: Record<string, string[]>;
  /** channelId -> that replica's live indicator aggregate (design doc §1a) */
  indicators?: Record<string, RemoteIndicator>;
}

/** The seam tests replace with an in-memory bus; production wires NATS. */
export interface SyncTransport {
  publishSnapshot(payload: SyncPayload): void;
  /** Deliver every *other* replica's snapshots to `handler`; returns unsubscribe. */
  onSnapshot(handler: (payload: SyncPayload) => void): () => void;
  publishPresence(workspaceId: string, userId: string, status: 'online' | 'offline'): void;
  /** Announce a channel whose merged indicator aggregate went quiet. */
  publishIndicatorCleared(ref: ChannelRef): void;
}

function presenceEvent(workspaceId: string, userId: string, status: 'online' | 'offline'): Event {
  return {
    type: 'presence',
    workspaceId,
    ts: new Date().toISOString(),
    data: { userId, status },
  };
}

function natsTransport(): SyncTransport {
  return {
    publishSnapshot(payload) {
      // publishEvent is (subject, Event) — the sync payload is not a client
      // Event, but the transport is the same fire-and-forget JSON publish.
      publishEvent(subjectPresenceSync(payload.replicaId), payload as unknown as Event);
    },
    onSnapshot(handler) {
      const sub = subscribeBus(subjectPresenceSyncAll());
      void (async () => {
        for await (const m of sub) {
          try {
            handler(JSON.parse(new TextDecoder().decode(m.data)) as SyncPayload);
          } catch {
            /* skip malformed */
          }
        }
      })();
      return () => sub.unsubscribe();
    },
    publishPresence(workspaceId, userId, status) {
      publishEvent(subjectPresence(workspaceId), presenceEvent(workspaceId, userId, status));
    },
    publishIndicatorCleared({ channelId, workspaceId }) {
      // same shape services/channelIndicators.ts publishes for a clear
      publishEvent(subjectIndicator(workspaceId, channelId), {
        type: 'channel.indicator',
        workspaceId,
        channelId,
        ts: new Date().toISOString(),
        data: { channelId, state: null },
      });
    },
  };
}

export interface PresenceSyncHandle {
  replicaId: string;
  /** One heartbeat: publish, expire, elect. Exposed for tests; the interval calls it. */
  tick(now?: number): void;
  stop(): void;
}

export function startPresenceSync(opts?: {
  store?: PresenceStore;
  transport?: SyncTransport;
  heartbeatMs?: number;
  expiryMs?: number;
  replicaId?: string;
}): PresenceSyncHandle {
  const store = opts?.store ?? presenceStore;
  const transport = opts?.transport ?? natsTransport();
  const heartbeatMs = opts?.heartbeatMs ?? HEARTBEAT_MS;
  const expiryMs = opts?.expiryMs ?? EXPIRY_MS;
  // Per-process-boot random: Railway replicas have no stable identity, and a
  // restart is just a new id whose predecessor expires.
  const replicaId = opts?.replicaId ?? randomUUID();

  /** Emit offline for merged-view drops iff we hold the smallest live id.
   * Every survivor computes the same drops from the same data; the election
   * picks one emitter, and a disagreement during a membership change costs at
   * most a duplicate event, which clients treat as idempotent state. */
  const emitElected = (wentOffline: { workspaceId: string; userId: string }[]): void => {
    if (wentOffline.length === 0) return;
    const smallestLive = [replicaId, ...store.liveRemoteReplicaIds()].sort()[0];
    if (smallestLive !== replicaId) return;
    for (const { workspaceId, userId } of wentOffline) {
      transport.publishPresence(workspaceId, userId, 'offline');
    }
  };

  /** Same election for indicator clears (they mirror offline events). */
  const emitElectedQuiets = (quieted: ChannelRef[]): void => {
    if (quieted.length === 0) return;
    const smallestLive = [replicaId, ...store.liveRemoteReplicaIds()].sort()[0];
    if (smallestLive !== replicaId) return;
    for (const ref of quieted) transport.publishIndicatorCleared(ref);
  };

  const unsubscribe = transport.onSnapshot((payload) => {
    if (!payload || payload.replicaId === replicaId) return;
    if (typeof payload.replicaId !== 'string' || typeof payload.workspaces !== 'object') return;
    // A snapshot shrinking the merged view carries offline transitions whose
    // origin replica suppressed them against a then-live view of us — the
    // two-closes-within-one-beat window. The elected emitter publishes them.
    emitElected(store.applyRemoteSnapshot(payload.replicaId, payload.workspaces ?? {}));
    emitElectedQuiets(applyRemoteIndicators(payload.replicaId, payload.indicators ?? {}));
  });

  const tick = (now: number = Date.now()): void => {
    transport.publishSnapshot({
      replicaId,
      workspaces: store.localSnapshot(),
      indicators: localIndicatorSnapshot(now),
    });
    // A replica that died took its users' offline events (and its channels'
    // spinner clears) with it: on expiry, the elected survivor emits for
    // whatever left the merged view.
    emitElected(store.expireRemote(expiryMs, now));
    emitElectedQuiets(expireRemoteIndicators(expiryMs, now));
  };

  const timer = setInterval(tick, heartbeatMs);
  timer.unref();
  tick(); // announce immediately so a booting replica completes others' views within one beat

  return {
    replicaId,
    tick,
    stop() {
      clearInterval(timer);
      unsubscribe();
    },
  };
}
