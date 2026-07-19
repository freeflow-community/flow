// WS Gateway (phase1.md §3/§4). Runs in the same Node process as the API —
// the seam between them is NATS subjects.
import type { Server as HttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { inArray, eq } from 'drizzle-orm';
import type { ClientFrame, Event, ServerFrame } from '@flow/shared';
import { db, schema } from '../db/index.js';
import * as auth from '../services/auth.js';
import {
  publishEvent,
  subjectPresence,
  subjectTyping,
  subjectUserMeta,
  subjectUserNotify,
  subjectWorkspaceAll,
  subscribeBus,
} from '../bus.js';
import { online } from '../presence.js';

const { workspaceMembers, channels, channelMembers } = schema;

const HEARTBEAT_MS = Number(process.env.FLOW_HEARTBEAT_MS ?? 30_000); // spec: 30s; env override for tests
const AUTH_TIMEOUT_MS = 10_000;

interface SocketState {
  sessionId: string;
  userId: string;
  workspaces: Set<string>;
  /** channelId -> {workspaceId, isPrivate} for channels visible at auth (or learned via meta). */
  chans: Map<string, { workspaceId: string; isPrivate: boolean }>;
  /** channels the user is a member of */
  member: Set<string>;
  subs: { unsubscribe(): void }[];
}

// single-node presence: the userId -> socket-count map lives in ../presence.js
// (shared with the notification service for <!here> resolution).
// userId -> workspaces (for presence fan-out on disconnect)
const socketsByUser = new Map<string, Set<SocketState>>();

function send(sock: WebSocket, frame: ServerFrame): void {
  if (sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify(frame));
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
  s.subs.push(sub);
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

/** Tell this socket who is currently online in shared workspaces (local map, single node). */
function sendPresenceSnapshot(s: SocketState, sock: WebSocket, onlyWorkspaceId?: string): void {
  for (const [uid, n] of online) {
    if (n <= 0 || uid === s.userId) continue;
    const other = socketsByUser.get(uid);
    if (!other) continue;
    for (const otherState of other) {
      for (const wsId of otherState.workspaces) {
        if (s.workspaces.has(wsId) && (!onlyWorkspaceId || wsId === onlyWorkspaceId)) {
          send(sock, { op: 'event', event: presenceEvent(wsId, uid, 'online') });
        }
      }
      break; // one socket is enough to know their workspaces
    }
  }
}

export function attachGateway(server: HttpServer): { close(): void } {
  const wss = new WebSocketServer({ server, path: '/v1/ws' });
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
            state = {
              sessionId: randomUUID(),
              userId: user.id,
              ...loaded,
              subs: [],
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
                  if ((online.get(s.userId) ?? 0) > 0) {
                    publishEvent(
                      subjectPresence(event.workspaceId),
                      presenceEvent(event.workspaceId, s.userId, 'online'),
                    );
                  }
                  sendPresenceSnapshot(s, sock, event.workspaceId);
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

            // presence bookkeeping (single node: local map is authoritative)
            if (!socketsByUser.has(s.userId)) socketsByUser.set(s.userId, new Set());
            socketsByUser.get(s.userId)!.add(s);
            const count = (online.get(s.userId) ?? 0) + 1;
            online.set(s.userId, count);
            if (count === 1) {
              for (const wsId of s.workspaces) {
                publishEvent(subjectPresence(wsId), presenceEvent(wsId, s.userId, 'online'));
              }
            }

            send(sock, { op: 'hello', sessionId: s.sessionId });

            // presence snapshot: everyone currently online (local map, single node)
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

        if (frame.op === 'pong') {
          liveness.set(sock, true);
          return;
        }

        if (frame.op === 'typing') {
          // ephemeral, loss-tolerant → straight to NATS (spec §1)
          const chan = state.chans.get(frame.channelId);
          if (!chan) return;
          if (chan.isPrivate && !state.member.has(frame.channelId)) return;
          publishEvent(subjectTyping(chan.workspaceId, frame.channelId), {
            type: 'typing',
            workspaceId: chan.workspaceId,
            channelId: frame.channelId,
            ts: new Date().toISOString(),
            data: { userId: state.userId, channelId: frame.channelId },
          });
        }
      })();
    });

    sock.on('close', () => {
      clearTimeout(authTimer);
      liveness.delete(sock);
      if (!state) return;
      for (const sub of state.subs) sub.unsubscribe();
      socketsByUser.get(state.userId)?.delete(state);
      const count = (online.get(state.userId) ?? 1) - 1;
      if (count <= 0) {
        online.delete(state.userId);
        socketsByUser.delete(state.userId);
        for (const wsId of state.workspaces) {
          publishEvent(subjectPresence(wsId), presenceEvent(wsId, state.userId, 'offline'));
        }
      } else {
        online.set(state.userId, count);
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
  }, HEARTBEAT_MS);

  return {
    close() {
      clearInterval(heartbeat);
      for (const sock of wss.clients) sock.close(1001, 'server shutdown');
      wss.close();
    },
  };
}
