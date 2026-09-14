// Distributed presence (phase 18 M2): two in-process "replicas" — two
// PresenceStore instances wired through an in-memory bus with the same shape
// as the NATS transport. Pure in-memory, no database, no NATS daemon.
import { beforeEach, describe, expect, it } from 'vitest';
import { PresenceStore } from '../src/presence.js';
import { startPresenceSync, type SyncPayload, type SyncTransport } from '../src/presenceSync.js';
import {
  applyRemoteIndicators,
  channelIndicator,
  channelIndicators,
  expireRemoteIndicators,
  localIndicatorSnapshot,
  resetIndicators,
  setIndicator,
  sweepExpired,
} from '../src/indicators.js';

// the indicators module is process-global (one replica per process in prod);
// keep tests from leaking into each other
beforeEach(() => resetIndicators());

const U1 = 'user-1';
const U2 = 'user-2';
const WS = 'ws-main';

/** In-memory bus shared by every replica's transport, recording presence events. */
function fakeBus() {
  const handlers = new Set<(p: SyncPayload) => void>();
  const presenceEvents: { workspaceId: string; userId: string; status: string }[] = [];
  const indicatorClears: { channelId: string; workspaceId: string }[] = [];
  let down = false;
  return {
    presenceEvents,
    indicatorClears,
    setDown(v: boolean) {
      down = v;
    },
    transport(): SyncTransport {
      return {
        publishSnapshot(payload) {
          if (down) return;
          for (const h of [...handlers]) h(payload); // every replica hears every beat, self included
        },
        onSnapshot(handler) {
          handlers.add(handler);
          return () => handlers.delete(handler);
        },
        publishPresence(workspaceId, userId, status) {
          presenceEvents.push({ workspaceId, userId, status });
        },
        publishIndicatorCleared(ref) {
          indicatorClears.push(ref);
        },
      };
    },
  };
}

/** A replica: its own store + sync loop (interval effectively disabled; tests drive tick()). */
function replica(bus: ReturnType<typeof fakeBus>, replicaId: string) {
  const store = new PresenceStore();
  const sync = startPresenceSync({
    store,
    transport: bus.transport(),
    replicaId,
    heartbeatMs: 3_600_000,
    expiryMs: 30_000,
  });
  return { store, sync };
}

describe('merged reads across replicas', () => {
  it('a user connected to A reads online on B after one beat', () => {
    const bus = fakeBus();
    const a = replica(bus, 'aaa');
    const b = replica(bus, 'bbb');

    a.store.registerConnection('c1', U1, [WS]);
    expect(b.store.isOnline(U1, WS)).toBe(false); // no beat yet
    a.sync.tick();
    expect(b.store.isOnline(U1, WS)).toBe(true);
    expect(b.store.onlineUsersIn(WS)).toContain(U1);
    expect(b.store.hasAnyConnection(U1)).toBe(true);
    // and the merged snapshot combines both sides
    b.store.registerConnection('c2', U2, [WS]);
    expect(b.store.onlineUsersIn(WS).sort()).toEqual([U1, U2].sort());

    a.sync.stop();
    b.sync.stop();
  });
});

describe('event dedup', () => {
  it('closing the last socket on one replica stays quiet while the other still holds one', () => {
    const bus = fakeBus();
    const a = replica(bus, 'aaa');
    const b = replica(bus, 'bbb');

    a.store.registerConnection('c1', U1, [WS]);
    b.store.registerConnection('c2', U1, [WS]);
    a.sync.tick();
    b.sync.tick();

    // last *local* socket on A closes; B still has one → merged answer
    // unchanged → no offline event from A's bookkeeping
    expect(a.store.unregisterConnection('c1')).toEqual([]);
    expect(b.store.isOnline(U1, WS)).toBe(true);

    // after A's next beat clears its entry, B's close is the global one
    a.sync.tick();
    expect(b.store.unregisterConnection('c2')).toEqual([WS]);

    a.sync.stop();
    b.sync.stop();
  });

  it('both sockets closing within one beat still yields an elected offline event', () => {
    const bus = fakeBus();
    const a = replica(bus, 'aaa');
    const b = replica(bus, 'bbb');

    a.store.registerConnection('c1', U1, [WS]);
    b.store.registerConnection('c2', U1, [WS]);
    a.sync.tick();
    b.sync.tick();

    // Both close before either beats: each side suppresses (the other's stale
    // snapshot still claims the user) — the design-doc rule would lose the
    // offline event entirely.
    expect(a.store.unregisterConnection('c1')).toEqual([]);
    expect(b.store.unregisterConnection('c2')).toEqual([]);
    expect(bus.presenceEvents).toEqual([]);

    // The next beats carry shrunken snapshots; the elected replica emits.
    a.sync.tick();
    b.sync.tick();
    const offline = bus.presenceEvents.filter((e) => e.status === 'offline' && e.userId === U1);
    expect(offline.length).toBeGreaterThanOrEqual(1);
    expect(offline[0]).toEqual({ workspaceId: WS, userId: U1, status: 'offline' });

    a.sync.stop();
    b.sync.stop();
  });
});

describe('replica crash expiry', () => {
  // Real timers here: the survivors must keep refreshing each other while the
  // dead replica's entry ages out, which a jumped clock can't express.
  it('a dead replica expires and exactly one survivor emits the offline events', async () => {
    const bus = fakeBus();
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const fast = { heartbeatMs: 30, expiryMs: 500 };
    const store = (id: string) => {
      const s = new PresenceStore();
      return { store: s, sync: startPresenceSync({ store: s, transport: bus.transport(), replicaId: id, ...fast }) };
    };
    const a = store('aaa');
    const b = store('bbb');
    const c = store('ccc');

    a.store.registerConnection('c1', U1, [WS]);
    a.sync.tick();
    await sleep(100);
    expect(b.store.isOnline(U1, WS)).toBe(true);
    expect(c.store.isOnline(U1, WS)).toBe(true);

    // A dies silently. B and C keep beating (30ms) so they stay live to each
    // other; A's entry crosses the 500ms TTL and only the smallest live id
    // (B, 'bbb') emits — C computes the same drop and stays quiet.
    a.sync.stop();
    await sleep(900);

    const offline = bus.presenceEvents.filter((e) => e.status === 'offline');
    expect(offline).toEqual([{ workspaceId: WS, userId: U1, status: 'offline' }]);
    expect(b.store.isOnline(U1, WS)).toBe(false);
    expect(c.store.isOnline(U1, WS)).toBe(false);

    b.sync.stop();
    c.sync.stop();
  });

  it('no offline event when the expired replica user is online elsewhere', () => {
    const bus = fakeBus();
    const a = replica(bus, 'aaa');
    const b = replica(bus, 'bbb');

    a.store.registerConnection('c1', U1, [WS]);
    b.store.registerConnection('c2', U1, [WS]);
    a.sync.tick();
    b.sync.tick();

    a.sync.stop(); // A dies, but U1 is also connected to B
    b.sync.tick(Date.now() + 31_000);
    expect(bus.presenceEvents.filter((e) => e.status === 'offline')).toEqual([]);
    expect(b.store.isOnline(U1, WS)).toBe(true);

    b.sync.stop();
  });
});

describe('bus degradation', () => {
  it('falls back to the local view when the bus drops, and heals on recovery', () => {
    const bus = fakeBus();
    const a = replica(bus, 'aaa');
    const b = replica(bus, 'bbb');

    a.store.registerConnection('c1', U1, [WS]);
    a.sync.tick();
    expect(b.store.isOnline(U1, WS)).toBe(true);

    bus.setDown(true);
    a.sync.tick(); // beats go nowhere
    // B still serves its (aging) view now, local view after expiry
    const later = Date.now() + 31_000;
    b.sync.tick(later);
    expect(b.store.isOnline(U1, WS)).toBe(false); // local-only: B has no sockets for U1
    expect(a.store.isOnline(U1, WS)).toBe(true); // A's local view is intact

    bus.setDown(false);
    a.sync.tick(later);
    expect(b.store.isOnline(U1, WS)).toBe(true); // one beat heals the merged view

    a.sync.stop();
    b.sync.stop();
  });
});

describe('indicator aggregates across replicas (design doc §1a)', () => {
  const CHAN = 'chan-1';

  it('a remote replica spinner shows in the merged read and the channel-list overlay', () => {
    expect(channelIndicator(CHAN)).toBeNull();
    applyRemoteIndicators('r1', { [CHAN]: { workspaceId: WS, state: 'busy' } });
    expect(channelIndicator(CHAN)).toBe('busy');
    expect(channelIndicators([CHAN]).get(CHAN)).toBe('busy');
  });

  it('the local aggregate wins and the heartbeat snapshot never echoes remote state', () => {
    applyRemoteIndicators('r1', { [CHAN]: { workspaceId: WS, state: 'busy' } });
    setIndicator(CHAN, WS, U1, 'busy');
    expect(channelIndicator(CHAN)).toBe('busy');
    // snapshot carries only what *this* replica's setters hold
    expect(localIndicatorSnapshot()[CHAN]?.state).toBe('busy');
    resetIndicators();
    applyRemoteIndicators('r1', { [CHAN]: { workspaceId: WS, state: 'busy' } });
    expect(localIndicatorSnapshot()[CHAN]).toBeUndefined();
  });

  it('a snapshot diff quiets a channel only when the merged aggregate is gone', () => {
    applyRemoteIndicators('r1', { [CHAN]: { workspaceId: WS, state: 'busy' } });
    // still held locally → the diff does not announce quiet
    setIndicator(CHAN, WS, U1, 'busy');
    expect(applyRemoteIndicators('r1', {})).toEqual([]);
    resetIndicators();
    applyRemoteIndicators('r1', { [CHAN]: { workspaceId: WS, state: 'busy' } });
    expect(applyRemoteIndicators('r1', {})).toEqual([{ channelId: CHAN, workspaceId: WS }]);
  });

  it('a crashed replica expires and its spinners quiet, unless held elsewhere', () => {
    const t0 = Date.now();
    applyRemoteIndicators('r1', { [CHAN]: { workspaceId: WS, state: 'busy' } }, t0);
    applyRemoteIndicators('r2', { [CHAN]: { workspaceId: WS, state: 'busy' } }, t0 + 25_000);
    // r1 expires; r2 still holds the channel → nothing quiets
    expect(expireRemoteIndicators(30_000, t0 + 31_000)).toEqual([]);
    // r2 expires too → now it quiets
    expect(expireRemoteIndicators(30_000, t0 + 60_000)).toEqual([{ channelId: CHAN, workspaceId: WS }]);
    expect(channelIndicator(CHAN)).toBeNull();
  });

  it('the local sweeper stays quiet about a channel still spinning via a remote replica', () => {
    const t0 = Date.now();
    setIndicator(CHAN, WS, U1, 'busy', 1, t0); // 1ms TTL — lapses immediately
    applyRemoteIndicators('r1', { [CHAN]: { workspaceId: WS, state: 'busy' } }, t0 + 10);
    expect(sweepExpired(t0 + 10)).toEqual([]); // merged aggregate still live
    resetIndicators();
    setIndicator(CHAN, WS, U1, 'busy', 1, t0);
    expect(sweepExpired(t0 + 10)).toEqual([{ channelId: CHAN, workspaceId: WS }]);
  });
});
