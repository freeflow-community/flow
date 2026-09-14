// WS Gateway (phase1.md §3/§4). Runs in the same Node process as the API —
// the seam between them is NATS subjects.
import type { Server as HttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { inArray, eq } from 'drizzle-orm';
import type { ClientFrame, Event, ServerFrame } from '@flow/shared';
import { db, schema } from '../db/index.js';
import * as auth from '../services/auth.js';
import { clearIndicatorsOnDisconnect } from '../services/channelIndicators.js';
import {
  publishEvent,
  subjectPresence,
  subjectTyping,
  subjectUserMeta,
  subjectUserNotify,
  subjectWorkspaceAll,
  subscribeBus,
} from '../bus.js';
import {
  addWorkspace as addPresenceWorkspace,
  hasAnyConnection,
  onlineUsersIn,
  registerConnection,
  removeWorkspace as removePresenceWorkspace,
  sweepStale,
  touchConnection,
  unregisterConnection,
} from '../presence.js';
import { routeUpgrade } from './upgrade.js';

const { workspaceMembers, channels, channelMembers } = schema;

const HEARTBEAT_MS = Number(process.env.FLOW_HEARTBEAT_MS ?? 30_000); // spec: 30s; env override for tests
const AUTH_TIMEOUT_MS = 10_000;
// Presence TTL backstop (#364): three missed beats. The 'close' handler is the
// fast path; this catches connections whose close never arrives (half-open
// socket, slept laptop, killed process) so a dot can't stay green forever.
const PRESENCE_TTL_MS = Number(process.env.FLOW_PRESENCE_TTL_MS ?? HEARTBEAT_MS * 3);

interface SocketState {
  sessionId: string;
  userId: string;
  /** every workspace this socket receives events for (all of the user's) */
  workspaces: Set<string>;
  /**
   * The workspaces this connection declared it actually serves (#364), or null
   * for "all of them". An agent bridge runs one process per workspace and
   * ignores events for the others, so announcing it online everywhere put a
   * green dot next to an agent that was not listening. Subscription scope is
   * deliberately left alone — only presence is narrowed.
   */
  declared: Set<string> | null;
  /** channelId -> {workspaceId, isPrivate} for channels visible at auth (or learned via meta). */
  chans: Map<string, { workspaceId: string; isPrivate: boolean }>;
  /** channels the user is a member of */
  member: Set<string>;
  subs: { unsubscribe(): void }[];
  /** workspaceId -> that workspace's wildcard subscription, so leaving one
   * workspace can drop exactly its sub without disturbing the others. */
  wsSubs: Map<string, { unsubscribe(): void }>;
  sock: WebSocket;
}

// single-node presence: the (user, workspace) connection registry lives in
// ../presence.js (shared with the notification service for <!here> resolution).
// userId -> live sockets (force-close, workspace detach)
const socketsByUser = new Map<string, Set<SocketState>>();

function send(sock: WebSocket, frame: ServerFrame): void {
  if (sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify(frame));
}

/**
 * Force-close every live socket a user holds (account deletion). The close
 * handler does the usual bookkeeping (presence fan-out, sub teardown).
 */
export function disconnectUser(userId: string): void {
  for (const s of socketsByUser.get(userId) ?? []) {
    s.sock.close(4003, 'account deleted');
  }
}

/**
 * Drop one workspace from every socket a user holds (leaving a workspace).
 * Unlike `disconnectUser` this is surgical: the socket stays up and keeps
 * serving the user's *other* workspaces, it just stops receiving this one.
 *
 * The departure event is written straight to the socket before the
 * unsubscribe. The bus is fire-and-forget core NATS, so relying on the
 * published `member.left` to arrive before we tear the subscription down is a
 * race the leaver loses — and losing it means their other clients never learn
 * they left. Clients may therefore see the event twice; handling is
 * idempotent on all three.
 */
export function detachUserFromWorkspace(userId: string, workspaceId: string): void {
  for (const s of socketsByUser.get(userId) ?? []) {
    if (!s.workspaces.has(workspaceId)) continue;
    send(s.sock, {
      op: 'event',
      event: {
        type: 'member.left',
        workspaceId,
        ts: new Date().toISOString(),
        data: { userId, workspaceId },
      },
    });
    s.wsSubs.get(workspaceId)?.unsubscribe();
    s.wsSubs.delete(workspaceId);
    s.workspaces.delete(workspaceId);
    s.declared?.delete(workspaceId);
    // presence goes with the membership: no dot in a workspace we just left
    if (removePresenceWorkspace(s.sessionId, workspaceId)) {
      publishEvent(subjectPresence(workspaceId), presenceEvent(workspaceId, userId, 'offline'));
    }
    for (const [chanId, meta] of s.chans) {
      if (meta.workspaceId !== workspaceId) continue;
      s.chans.delete(chanId);
      s.member.delete(chanId);
    }
  }
}

async function loadState(userId: string): Promise<Pick<SocketState, 'workspaces' | 'chans' | 'member'>> {
  const wsRows = await db
    .select({ workspaceId: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId));
  const workspaceIds = wsRows.map((r) => r.workspaceId);

  const chans = new Map<string, { workspaceId: string; isPrivate: boolean }>();
  const member = new Set<string>();
  if (workspaceIds.length > 0) {
    const chanRows = await db
      .select({ id: channels.id, workspaceId: channels.workspaceId, isPrivate: channels.isPrivate })
      .from(channels)
      .where(inArray(channels.workspaceId, workspaceIds));
    for (const c of chanRows) chans.set(c.id, { workspaceId: c.workspaceId, isPrivate: c.isPrivate });
    const memRows = await db
      .select({ channelId: channelMembers.channelId })
      .from(channelMembers)
      .where(eq(channelMembers.userId, userId));
    for (const m of memRows) if (chans.has(m.channelId)) member.add(m.channelId);
  }
  return { workspaces: new Set(workspaceIds), chans, member };
}

/** Should this socket receive this event? (private-channel filter per spec §3) */
function visible(state: SocketState, event: Event): boolean {
  if (!event.channelId) return true; // presence / workspace-level meta
  const chan = state.chans.get(event.channelId);
  if (!chan) return false; // unknown channel (e.g. private channel we were never told about)
  if (chan.isPrivate && !state.member.has(event.channelId)) return false;
  return true;
}

/** Keep the per-socket membership cache fresh from meta events (spec §3). */
function applyMetaEvent(state: SocketState, event: Event): void {
  if (event.type === 'channel.created') {
    const data = event.data as { id: string; isPrivate: boolean; createdBy: string };
    state.chans.set(data.id, { workspaceId: event.workspaceId, isPrivate: data.isPrivate });
    if (data.createdBy === state.userId) state.member.add(data.id);
  } else if (event.type === 'member.joined') {
    const data = event.data as { userId: string; channelId?: string };
    if (data.userId === state.userId && event.channelId) state.member.add(event.channelId);
  } else if (event.type === 'member.left') {
    const data = event.data as { userId: string; channelId?: string };
    if (data.userId === state.userId && event.channelId) state.member.delete(event.channelId);
  }
}

function presenceEvent(workspaceId: string, userId: string, status: 'online' | 'offline'): Event {
  return {
    type: 'presence',
    workspaceId,
    ts: new Date().toISOString(),
    data: { userId, status },
  };
}

/** Subscribe a socket to one workspace's wildcard subject and pump events to it. */
function attachWorkspaceSub(s: SocketState, sock: WebSocket, wsId: string): void {
  const sub = subscribeBus(subjectWorkspaceAll(wsId));
  s.wsSubs.set(wsId, sub);
  void (async () => {
    for await (const m of sub) {
      try {
        const event = JSON.parse(new TextDecoder().decode(m.data)) as Event;
        // visibility straddles membership changes: an invite (member.joined) is
        // only visible AFTER the cache updates; one's own departure
        // (member.left) only BEFORE. Check both sides of the update.
        const visibleBefore = visible(s, event);
        if (m.subject.endsWith('.meta')) applyMetaEvent(s, event);
        if (visibleBefore || visible(s, event)) send(sock, { op: 'event', event });
      } catch {
        /* skip malformed */
      }
    }
  })();
}

/** Load one workspace's channels + this user's memberships into socket state. */
async function loadWorkspaceIntoState(s: SocketState, wsId: string): Promise<void> {
  const chanRows = await db
    .select({ id: channels.id, workspaceId: channels.workspaceId, isPrivate: channels.isPrivate })
    .from(channels)
    .where(eq(channels.workspaceId, wsId));
  for (const c of chanRows) s.chans.set(c.id, { workspaceId: c.workspaceId, isPrivate: c.isPrivate });
  const memRows = await db
    .select({ channelId: channelMembers.channelId })
    .from(channelMembers)
    .where(eq(channelMembers.userId, s.userId));
  for (const m of memRows) if (s.chans.has(m.channelId)) s.member.add(m.channelId);
}

/**
 * Tell this socket who is currently online, per workspace (merged across
 * replicas since phase 18 M2 — onlineUsersIn unions the gossip view).
 * Presence is per (user, workspace) since #364, so the snapshot is a straight
 * read of each workspace's online set — a user online in one of our
 * workspaces is *not* reported online in the others.
 */
function sendPresenceSnapshot(s: SocketState, sock: WebSocket, onlyWorkspaceId?: string): void {
  for (const wsId of s.workspaces) {
    if (onlyWorkspaceId && wsId !== onlyWorkspaceId) continue;
    for (const uid of onlineUsersIn(wsId)) {
      if (uid === s.userId) continue;
      send(sock, { op: 'event', event: presenceEvent(wsId, uid, 'online') });
    }
  }
}

export function attachGateway(server: HttpServer): { close(): void } {
  // noServer + shared router — see gateway/upgrade.ts for why {server, path}
  // can't be used once a second WebSocketServer shares this HTTP server.
  const wss = new WebSocketServer({ noServer: true });
  routeUpgrade(server, '/v1/ws', wss);
  const liveness = new Map<WebSocket, boolean>();

  wss.on('connection', (sock: WebSocket) => {
    let state: SocketState | null = null;
    liveness.set(sock, true);

    const authTimer = setTimeout(() => {
      if (!state) sock.close(4001, 'auth timeout');
    }, AUTH_TIMEOUT_MS);

    sock.on('message', (raw) => {
      void (async () => {
        let frame: ClientFrame;
        try {
          frame = JSON.parse(String(raw)) as ClientFrame;
        } catch {
          return send(sock, { op: 'error', code: 'bad_frame', message: 'invalid JSON' });
        }

        if (frame.op === 'auth') {
          if (state) return;
          try {
            const user = await auth.authenticate(frame.token);
            clearTimeout(authTimer);
            const loaded = await loadState(user.id);
            // #364: a client may declare which workspaces this connection
            // actually serves. Unknown ids are dropped (membership is the
            // server's call); omitting the field means "all of them", which is
            // right for the human clients — one app window is genuinely
            // reachable in every workspace it shows.
            const declared = Array.isArray(frame.workspaces)
              ? new Set(frame.workspaces.filter((w) => loaded.workspaces.has(w)))
              : null;
            state = {
              sessionId: randomUUID(),
              userId: user.id,
              ...loaded,
              declared,
              subs: [],
              wsSubs: new Map(),
              sock,
            };
            const s = state;

            // one wildcard subscription per workspace (spec §3)
            for (const wsId of s.workspaces) {
              attachWorkspaceSub(s, sock, wsId);
            }

            // sockets auth before joins happen: follow workspace joins/creates live,
            // so a socket connected pre-join still gets subscribed (fixes dead presence
            // and fan-out for workspaces entered after connect)
            const userSub = subscribeBus(subjectUserMeta(s.userId));
            s.subs.push(userSub);
            void (async () => {
              for await (const m of userSub) {
                try {
                  const event = JSON.parse(new TextDecoder().decode(m.data)) as Event;
                  if (event.type !== 'workspace.joined' || s.workspaces.has(event.workspaceId)) continue;
                  s.workspaces.add(event.workspaceId);
                  await loadWorkspaceIntoState(s, event.workspaceId);
                  attachWorkspaceSub(s, sock, event.workspaceId);
                  // a scoped connection (agent bridge) doesn't start serving a
                  // workspace just because its user was added to one
                  if (!s.declared && addPresenceWorkspace(s.sessionId, event.workspaceId)) {
                    publishEvent(
                      subjectPresence(event.workspaceId),
                      presenceEvent(event.workspaceId, s.userId, 'online'),
                    );
                  }
                  sendPresenceSnapshot(s, sock, event.workspaceId);
                  // forward after the subs are attached so the client's refetch
                  // lands on a socket that already receives the new workspace
                  send(sock, { op: 'event', event });
                } catch {
                  /* skip malformed */
                }
              }
            })();

            // per-user notification stream (phase2.md §4; user-global subject
            // per approved deviation) — always forwarded, no channel filter
            const notifySub = subscribeBus(subjectUserNotify(s.userId));
            s.subs.push(notifySub);
            void (async () => {
              for await (const m of notifySub) {
                try {
                  const event = JSON.parse(new TextDecoder().decode(m.data)) as Event;
                  send(sock, { op: 'event', event });
                } catch {
                  /* skip malformed */
                }
              }
            })();

            // presence bookkeeping (the local registry plus the replica
            // gossip view — presence.ts merges). Only the workspaces this
            // connection serves, and only the ones where it is the *first*
            // live local connection.
            if (!socketsByUser.has(s.userId)) socketsByUser.set(s.userId, new Set());
            socketsByUser.get(s.userId)!.add(s);
            for (const wsId of registerConnection(s.sessionId, s.userId, s.declared ?? s.workspaces)) {
              publishEvent(subjectPresence(wsId), presenceEvent(wsId, s.userId, 'online'));
            }

            send(sock, { op: 'hello', sessionId: s.sessionId });

            // presence snapshot: everyone currently online (merged across replicas)
            sendPresenceSnapshot(s, sock);
          } catch {
            send(sock, { op: 'error', code: 'unauthorized', message: 'invalid token' });
            sock.close(4003, 'unauthorized');
          }
          return;
        }

        if (!state) {
          return send(sock, { op: 'error', code: 'unauthorized', message: 'authenticate first' });
        }
        // anything from the client is proof of life for the presence TTL
        touchConnection(state.sessionId);

        if (frame.op === 'pong') {
          liveness.set(sock, true);
          return;
        }

        if (frame.op === 'typing') {
          // ephemeral, loss-tolerant → straight to NATS (spec §1)
          const chan = state.chans.get(frame.channelId);
          if (!chan) return;
          if (chan.isPrivate && !state.member.has(frame.channelId)) return;
          // threadRootId (optional) rides along so clients can scope the
          // indicator to the thread it was typed in rather than the channel.
          const threadRootId = typeof frame.threadRootId === 'string' ? frame.threadRootId : undefined;
          publishEvent(subjectTyping(chan.workspaceId, frame.channelId), {
            type: 'typing',
            workspaceId: chan.workspaceId,
            channelId: frame.channelId,
            ts: new Date().toISOString(),
            data: { userId: state.userId, channelId: frame.channelId, ...(threadRootId ? { threadRootId } : {}) },
          });
        }
      })();
    });

    sock.on('close', () => {
      clearTimeout(authTimer);
      liveness.delete(sock);
      if (!state) return;
      for (const sub of state.subs) sub.unsubscribe();
      for (const sub of state.wsSubs.values()) sub.unsubscribe();
      const peers = socketsByUser.get(state.userId);
      peers?.delete(state);
      if (peers?.size === 0) socketsByUser.delete(state.userId);
      // one event per workspace this close actually took the user offline in
      for (const wsId of unregisterConnection(state.sessionId)) {
        publishEvent(subjectPresence(wsId), presenceEvent(wsId, state.userId, 'offline'));
      }
      if (!peers || peers.size === 0) {
        // Going offline retracts any activity spinners this user left running
        // (#137) — an agent whose process died shouldn't spin a channel until
        // its TTL lapses.
        clearIndicatorsOnDisconnect(state.userId);
      }
      state = null;
    });
  });

  // 30s heartbeat (spec §4): send {op:"ping"}; a socket that hasn't answered
  // the previous ping with {op:"pong"} by the next beat is terminated.
  const heartbeat = setInterval(() => {
    for (const sock of wss.clients) {
      if (liveness.get(sock) === false) {
        sock.terminate();
        continue;
      }
      liveness.set(sock, false);
      send(sock, { op: 'ping' });
    }
    // TTL backstop (#364): a socket whose 'close' never fired still stops
    // answering, so its presence expires here rather than staying green.
    for (const stale of sweepStale(PRESENCE_TTL_MS)) {
      for (const wsId of stale.wentOffline) {
        publishEvent(subjectPresence(wsId), presenceEvent(wsId, stale.userId, 'offline'));
      }
      if (!hasAnyConnection(stale.userId)) clearIndicatorsOnDisconnect(stale.userId);
    }
  }, HEARTBEAT_MS);

  return {
    close() {
      clearInterval(heartbeat);
      for (const sock of wss.clients) sock.close(1001, 'server shutdown');
      wss.close();
    },
  };
}
