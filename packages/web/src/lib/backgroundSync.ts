// Background synchronisation for every *connected* server, not just the one on
// screen (docs/specs/multi-server-workspaces.md, "Runtime architecture":
// "Maintain background synchronization for connected sessions while web/macOS
// is running, using the existing subscription model for added workspaces").
//
// The foreground connection already has a full session — `Main.tsx` owns its
// socket, its query cache and its transcripts. This supervisor is what the
// *other* connections get: a socket, the per-workspace unread numbers, and
// nothing else. Deliberately nothing else — the spec's "avoid eager transcript
// downloads for all workspaces" is the whole reason this is a separate, much
// smaller thing rather than N mounted sessions. The only REST call it ever
// makes is `GET /v1/me/workspaces`.
//
// Everything here is per connection: its own socket, its own backoff, its own
// rate limiter, its own auth failure. A server that is down, throttling, or has
// revoked our token costs exactly one connection's sync and no others.
import { useSyncExternalStore } from 'react';
import type { Event, WorkspaceDTO } from '@flow/shared';
import { ApiError, connectionManager } from './connectionRuntime';
import type { ConnectionManager, ConnectionRuntime } from './connectionRuntime';
import { SocketClient, jittered, type SocketStatus } from './ws';

/** How many connections may be *starting up* at once.
 *
 * The bound is on the opening handshake and its first REST refresh, not on how
 * many sockets end up live: every connected server does stay subscribed, which
 * is the point of the feature. What it prevents is a client with eight servers
 * firing eight WebSocket upgrades and eight REST calls in the same tick on
 * launch or on wake — the moment when every one of them is slowest. A slot is
 * released as soon as its connection reaches `connected` (or gives up). */
export const MAX_CONCURRENT_STARTS = 3;

/** Floor between two `/v1/me/workspaces` refreshes on one connection. Events
 * arrive in bursts — a busy channel being read elsewhere emits one
 * `notification.read` per batch — and the unread numbers are not worth a
 * request each. */
export const MIN_REFRESH_MS = 5_000;

/** First delay after a rate-limited (429) refresh, doubled per repeat. */
export const RATE_LIMIT_BACKOFF_MS = 30_000;
export const MAX_RATE_LIMIT_BACKOFF_MS = 5 * 60_000;

export type ConnectionSyncStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'unauthorized' | 'offline';

export interface ConnectionSyncState {
  connectionId: string;
  status: ConnectionSyncStatus;
  /** workspaceId -> unread notifications, as this backend last reported them. */
  unreadByWorkspace: Record<string, number>;
  /** Sum over this connection's workspaces — what the switcher badges. */
  unread: number;
}

interface Timers {
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(handle: number): void;
}

export interface BackgroundSyncOptions {
  maxConcurrentStarts?: number;
  minRefreshMs?: number;
  now?: () => number;
  timers?: Timers;
  random?: () => number;
  /** Test seam: build the socket for a connection. */
  createSocket?(runtime: ConnectionRuntime, token: string, handlers: {
    onStatus(status: SocketStatus): void;
    onEvent(event: Event): void;
  }): { start(): void; stop(): void };
}

/** Events that can move an unread number. Everything else — typing, presence,
 * reactions on messages we are not tracking, artifact churn — is ignored,
 * because this supervisor holds no transcript to update. */
const UNREAD_EVENTS = new Set([
  'notification.created',
  'notification.read',
  'workspace.joined',
  'member.left',
]);

class ConnectionSync {
  status: ConnectionSyncStatus = 'idle';
  unreadByWorkspace: Record<string, number> = {};
  socket: { start(): void; stop(): void } | null = null;
  lastRefreshAt = 0;
  refreshTimer: number | null = null;
  rateLimitBackoff = 0;
  refreshing = false;
  /** Held while this connection occupies one of the start slots. */
  holdsSlot = false;

  constructor(readonly runtime: ConnectionRuntime) {}

  get unread(): number {
    return Object.values(this.unreadByWorkspace).reduce((a, b) => a + b, 0);
  }

  snapshot(): ConnectionSyncState {
    return {
      connectionId: this.runtime.connectionId,
      status: this.status,
      unreadByWorkspace: { ...this.unreadByWorkspace },
      unread: this.unread,
    };
  }
}

export class BackgroundSync {
  private readonly syncs = new Map<string, ConnectionSync>();
  private readonly listeners = new Set<() => void>();
  private readonly queue: string[] = [];
  private starting = 0;
  private running = false;
  /** The connection the UI is showing. It runs its own full session, so the
   * supervisor never opens a second socket for it. */
  private foreground: string | null = null;

  private readonly maxConcurrentStarts: number;
  private readonly minRefreshMs: number;
  private readonly now: () => number;
  private readonly timers: Timers;
  private readonly random: () => number;
  private readonly createSocket: NonNullable<BackgroundSyncOptions['createSocket']>;

  constructor(private readonly manager: ConnectionManager, opts: BackgroundSyncOptions = {}) {
    this.maxConcurrentStarts = opts.maxConcurrentStarts ?? MAX_CONCURRENT_STARTS;
    this.minRefreshMs = opts.minRefreshMs ?? MIN_REFRESH_MS;
    this.now = opts.now ?? (() => Date.now());
    this.timers = opts.timers ?? {
      setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms) as unknown as number,
      clearTimeout: (h) => globalThis.clearTimeout(h),
    };
    this.random = opts.random ?? Math.random;
    this.createSocket = opts.createSocket ?? ((runtime, token, handlers) =>
      new SocketClient(token, { ...handlers }, runtime.socketUrl, this.random));
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  /** Every connection's last-known state, foreground included (as `idle` with
   * whatever it last reported) so the switcher can render one list. */
  states(): ConnectionSyncState[] {
    return [...this.syncs.values()].map((sync) => sync.snapshot());
  }

  state(connectionId: string): ConnectionSyncState | null {
    return this.syncs.get(connectionId)?.snapshot() ?? null;
  }

  /** Aggregate unread across every background connection.
   *
   * Deliberately *excludes* the foreground connection: what the caller wants is
   * "how much is waiting on the servers I am not looking at", and the session on
   * screen already renders its own count. */
  backgroundUnread(): number {
    let total = 0;
    for (const [id, sync] of this.syncs) if (id !== this.foreground) total += sync.unread;
    return total;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.reconcile();
  }

  stop(): void {
    this.running = false;
    for (const sync of this.syncs.values()) this.teardown(sync);
    this.syncs.clear();
    this.queue.length = 0;
    this.starting = 0;
    this.emit();
  }

  /** Tell the supervisor which connection the UI took over. Its background
   * socket is dropped (the session owns one now) and the connection it *left*
   * is picked up. */
  setForeground(connectionId: string | null): void {
    if (this.foreground === connectionId) return;
    this.foreground = connectionId;
    if (connectionId) {
      const sync = this.syncs.get(connectionId);
      if (sync) {
        this.teardown(sync);
        sync.status = 'idle';
      }
    }
    this.reconcile();
  }

  /** Fold a foreground session's own unread numbers in, so switching away from
   * a connection does not blank its badge until its background socket has
   * reconnected and refreshed. */
  reportForeground(connectionId: string, workspaces: Pick<WorkspaceDTO, 'id' | 'unreadCount'>[]): void {
    const sync = this.syncs.get(connectionId) ?? this.adopt(connectionId);
    if (!sync) return;
    sync.unreadByWorkspace = unreadMap(workspaces);
    this.emit();
  }

  /** Bring the running set in line with the registry: start what should be
   * syncing, stop what should not. Cheap and idempotent — call it after any
   * registry change. */
  reconcile(): void {
    if (!this.running) return;
    const wanted = new Set<string>();
    for (const connection of this.manager.connections) {
      if (connection.provider !== 'flow') continue;
      const id = connection.connectionId;
      const session = this.manager.state.sessions.find((s) => s.connectionId === id);
      if (session?.status !== 'authenticated') {
        // Signed out, never signed in, or rejected: drop whatever it had. A
        // stale unread badge on a connection that cannot be read is a lie.
        const existing = this.syncs.get(id);
        if (existing) {
          this.teardown(existing);
          this.syncs.delete(id);
        }
        continue;
      }
      wanted.add(id);
      if (id === this.foreground) {
        this.adopt(id);
        continue;
      }
      const sync = this.adopt(id);
      if (sync && !sync.socket && sync.status !== 'unauthorized' && !this.queue.includes(id)) {
        this.queue.push(id);
      }
    }
    for (const [id, sync] of [...this.syncs]) {
      if (wanted.has(id)) continue;
      this.teardown(sync);
      this.syncs.delete(id);
    }
    this.pump();
    this.emit();
  }

  /** Get (or create) the per-connection record without starting anything. */
  private adopt(connectionId: string): ConnectionSync | null {
    const existing = this.syncs.get(connectionId);
    if (existing) return existing;
    const runtime = this.manager.runtime(connectionId);
    if (!runtime) return null;
    const sync = new ConnectionSync(runtime);
    this.syncs.set(connectionId, sync);
    return sync;
  }

  private pump(): void {
    while (this.running && this.starting < this.maxConcurrentStarts && this.queue.length) {
      const id = this.queue.shift()!;
      const sync = this.syncs.get(id);
      if (!sync || sync.socket || id === this.foreground) continue;
      this.startOne(sync);
    }
  }

  private releaseSlot(sync: ConnectionSync): void {
    if (!sync.holdsSlot) return;
    sync.holdsSlot = false;
    this.starting = Math.max(0, this.starting - 1);
    this.pump();
  }

  private startOne(sync: ConnectionSync): void {
    const token = sync.runtime.getToken();
    if (!token) {
      sync.status = 'idle';
      return;
    }
    sync.holdsSlot = true;
    this.starting += 1;
    sync.status = 'connecting';
    sync.socket = this.createSocket(sync.runtime, token, {
      onStatus: (status) => this.onStatus(sync, status),
      onEvent: (event) => this.onEvent(sync, event),
    });
    sync.socket.start();
    this.emit();
  }

  private onStatus(sync: ConnectionSync, status: SocketStatus): void {
    if (status === 'connected') {
      sync.status = 'connected';
      this.releaseSlot(sync);
      // Reconnect catch-up for a background connection is one small request,
      // not a transcript refetch: the numbers are all this holds.
      this.scheduleRefresh(sync, true);
    } else {
      sync.status = status === 'connecting' ? 'connecting' : 'reconnecting';
      // A socket that keeps failing must not hold a start slot forever.
      if (status === 'reconnecting') this.releaseSlot(sync);
    }
    this.emit();
  }

  private onEvent(sync: ConnectionSync, event: Event): void {
    if (!UNREAD_EVENTS.has(event.type)) return;
    // `notification.created` carries the workspace, so the count can move
    // without asking the server; anything else needs the authoritative numbers.
    if (event.type === 'notification.created' && event.workspaceId) {
      sync.unreadByWorkspace[event.workspaceId] = (sync.unreadByWorkspace[event.workspaceId] ?? 0) + 1;
      this.emit();
    }
    this.scheduleRefresh(sync, false);
  }

  /** Rate-limited `GET /v1/me/workspaces`. At most one in flight per
   * connection, at most one per `minRefreshMs`, and a 429 pushes the next one
   * out by a doubling backoff rather than retrying into the limiter. */
  private scheduleRefresh(sync: ConnectionSync, immediate: boolean): void {
    if (!this.running || sync.refreshTimer !== null) return;
    const floor = Math.max(this.minRefreshMs, sync.rateLimitBackoff);
    const since = this.now() - sync.lastRefreshAt;
    const wait = immediate && !sync.rateLimitBackoff ? 0 : Math.max(0, floor - since);
    if (wait === 0) {
      void this.refresh(sync);
      return;
    }
    sync.refreshTimer = this.timers.setTimeout(() => {
      sync.refreshTimer = null;
      void this.refresh(sync);
    }, jittered(wait, this.random));
  }

  private async refresh(sync: ConnectionSync): Promise<void> {
    if (sync.refreshing || !this.running) return;
    sync.refreshing = true;
    sync.lastRefreshAt = this.now();
    try {
      const result = await sync.runtime.api<{ workspaces: WorkspaceDTO[] }>('GET', '/v1/me/workspaces');
      sync.rateLimitBackoff = 0;
      sync.unreadByWorkspace = unreadMap(result.workspaces);
      if (sync.status === 'offline') sync.status = 'connected';
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      if (status === 401) {
        // Only this connection. The runtime already checked the auth generation,
        // so a 401 answering a pre-refresh request never gets here.
        sync.status = 'unauthorized';
        this.teardown(sync);
        this.manager.markUnauthorized(sync.runtime.connectionId);
      } else if (status === 429) {
        sync.rateLimitBackoff = Math.min(
          MAX_RATE_LIMIT_BACKOFF_MS,
          sync.rateLimitBackoff ? sync.rateLimitBackoff * 2 : RATE_LIMIT_BACKOFF_MS,
        );
      } else if (sync.status !== 'unauthorized') {
        sync.status = 'offline';
      }
    } finally {
      sync.refreshing = false;
      this.emit();
    }
  }

  private teardown(sync: ConnectionSync): void {
    sync.socket?.stop();
    sync.socket = null;
    this.releaseSlot(sync);
    if (sync.refreshTimer !== null) {
      this.timers.clearTimeout(sync.refreshTimer);
      sync.refreshTimer = null;
    }
    const queued = this.queue.indexOf(sync.runtime.connectionId);
    if (queued >= 0) this.queue.splice(queued, 1);
  }
}

function unreadMap(workspaces: Pick<WorkspaceDTO, 'id' | 'unreadCount'>[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const ws of workspaces) map[ws.id] = ws.unreadCount ?? 0;
  return map;
}

/** The process-wide supervisor, alongside `connectionManager()`. */
let supervisor: BackgroundSync | null = null;

export function backgroundSync(): BackgroundSync {
  supervisor ??= new BackgroundSync(connectionManager());
  return supervisor;
}

/** Test seam: replace the process-wide supervisor. */
export function __setBackgroundSync(next: BackgroundSync | null): void {
  supervisor = next;
}

/** Subscribe a component to the supervisor's per-connection state. */
export function useConnectionSync(): ConnectionSyncState[] {
  const sync = backgroundSync();
  return useSyncExternalStore(
    (listener) => sync.subscribe(listener),
    () => cachedStates(sync),
    () => EMPTY_STATES,
  );
}

// `useSyncExternalStore` compares snapshots by identity, so the getter has to
// return the *same* array until something actually changed. The supervisor
// notifies on every change, which is exactly when to rebuild it.
const EMPTY_STATES: ConnectionSyncState[] = [];
const snapshots = new WeakMap<BackgroundSync, { key: string; value: ConnectionSyncState[] }>();

function cachedStates(sync: BackgroundSync): ConnectionSyncState[] {
  const value = sync.states();
  const key = JSON.stringify(value);
  const previous = snapshots.get(sync);
  if (previous?.key === key) return previous.value;
  snapshots.set(sync, { key, value });
  return value;
}
