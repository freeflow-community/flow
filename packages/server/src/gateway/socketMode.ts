// Slack Socket Mode compatibility (see APPS.md): apps.connections.open mints
// a one-time ticket URL; the app's SocketModeClient connects here and events
// flow over the socket as {envelope_id, type:"events_api", payload} frames,
// acked by echoing {envelope_id}. The outbox in services/appEvents.ts stays
// the source of truth — this module is only the transport.
//
// Phase 18 M3 (design doc §3): the transport works across replicas.
// - **Tickets** live in Postgres (single-use via DELETE .. RETURNING, sha256
//   only), because apps.connections.open may answer on one replica while the
//   WebSocket upgrade lands on another.
// - **Envelope routing** is NATS request/reply: `deliverEnvelope` tries the
//   local socket first, then requests `app.{appId}.socketmode`; the replica
//   holding a socket subscribes there (queue group — exactly one responder
//   when an app has sockets on several replicas) and replies with the ack
//   result. "No responders" means no replica holds a socket — the caller's
//   HTTP fallback / outbox retry takes over, exactly as before. This replaces
//   the design doc's heartbeat-liveness idea (decision_log 2026-08-31): the
//   request itself is the liveness probe, with no staleness window.
// The in-memory connections/acks maps stay local — only this replica can
// write to its own sockets.
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import type { Subscription } from 'nats';
import { and, eq, gt, lt } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { hashToken, newToken } from '../lib/tokens.js';
import { requestBus, subjectAppSocketMode, subscribeBus } from '../bus.js';
import { routeUpgrade } from './upgrade.js';

const { appSocketTickets } = schema;

const TICKET_TTL_MS = 60_000;
const ACK_TIMEOUT_MS = 3_000;
/** ack timeout + headroom for the extra bus hop */
const ROUTE_TIMEOUT_MS = ACK_TIMEOUT_MS + 1_000;
/** Slack SDK clients treat a silent server as a dead connection — keep pinging. */
const PING_INTERVAL_MS = 15_000;

const connections = new Map<string, Set<WebSocket>>();
const pendingAcks = new Map<string, () => void>();
/** appId -> this replica's routing subscription (held while any local socket lives) */
const routeSubs = new Map<string, Subscription>();

/** One-time ticket for the wss URL returned by apps.connections.open. */
export async function mintSocketTicket(appId: string): Promise<string> {
  // opportunistic sweep, same spirit as the old in-memory map
  await db.delete(appSocketTickets).where(lt(appSocketTickets.expiresAt, new Date()));
  const ticket = newToken();
  await db.insert(appSocketTickets).values({
    tokenHash: hashToken(ticket),
    appId,
    expiresAt: new Date(Date.now() + TICKET_TTL_MS),
  });
  return ticket;
}

/** Redeem exactly once, on whichever replica the socket lands. */
export async function redeemSocketTicket(ticket: string): Promise<string | null> {
  const rows = await db
    .delete(appSocketTickets)
    .where(and(eq(appSocketTickets.tokenHash, hashToken(ticket)), gt(appSocketTickets.expiresAt, new Date())))
    .returning({ appId: appSocketTickets.appId });
  return rows[0]?.appId ?? null;
}

export function hasLiveSocket(appId: string): boolean {
  return (connections.get(appId)?.size ?? 0) > 0;
}

interface RouteRequest {
  envelopeId: string;
  payload: Record<string, unknown>;
  retryAttempt: number;
}

/** Send one envelope over a *local* live socket and await the client ack. */
function deliverLocal(
  appId: string,
  envelopeId: string,
  payload: Record<string, unknown>,
  retryAttempt: number,
): Promise<'acked' | 'timeout' | 'no_socket'> {
  const socks = connections.get(appId);
  const sock = socks && [...socks].find((s) => s.readyState === WebSocket.OPEN);
  if (!sock) return Promise.resolve('no_socket');
  const frame = JSON.stringify({
    envelope_id: envelopeId,
    type: 'events_api',
    payload,
    accepts_response_payload: false,
    retry_attempt: retryAttempt,
    retry_reason: retryAttempt > 0 ? 'timeout' : undefined,
  });
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingAcks.delete(envelopeId);
      resolve('timeout');
    }, ACK_TIMEOUT_MS);
    pendingAcks.set(envelopeId, () => {
      clearTimeout(timer);
      pendingAcks.delete(envelopeId);
      resolve('acked');
    });
    sock.send(frame, (err) => {
      if (err) {
        clearTimeout(timer);
        pendingAcks.delete(envelopeId);
        resolve('timeout');
      }
    });
  });
}

/**
 * Send one events_api envelope to whichever replica holds a live socket and
 * await the client ack. Local socket first (no bus hop); otherwise a NATS
 * request to the holding replica. 'no_socket' lets the caller fall back to
 * HTTP or leave the row queued.
 */
export async function deliverEnvelope(
  appId: string,
  envelopeId: string,
  payload: Record<string, unknown>,
  retryAttempt: number,
): Promise<'acked' | 'timeout' | 'no_socket'> {
  const local = await deliverLocal(appId, envelopeId, payload, retryAttempt);
  if (local !== 'no_socket') return local;
  try {
    const reply = await requestBus(
      subjectAppSocketMode(appId),
      { envelopeId, payload, retryAttempt } satisfies RouteRequest,
      ROUTE_TIMEOUT_MS,
    );
    if (!reply) return 'no_socket'; // bus not connected: single-node behavior
    const result = (reply as { result?: string }).result;
    return result === 'acked' ? 'acked' : result === 'timeout' ? 'timeout' : 'no_socket';
  } catch (err) {
    // NoRespondersError (code 503): no replica holds a socket. Anything else
    // (timeout, bus hiccup) is a transient the outbox retries through.
    const code = (err as { code?: unknown }).code;
    return code === '503' || code === 503 ? 'no_socket' : 'timeout';
  }
}

/** First local socket for an app: answer routed envelopes for it. */
function ensureRouteSub(appId: string): void {
  if (routeSubs.has(appId)) return;
  let sub: Subscription;
  try {
    sub = subscribeBus(subjectAppSocketMode(appId), { queue: 'socketmode' });
  } catch {
    return; // bus not connected (unit tests): local delivery still works
  }
  routeSubs.set(appId, sub);
  void (async () => {
    for await (const m of sub) {
      try {
        const req = JSON.parse(new TextDecoder().decode(m.data)) as RouteRequest;
        const result = await deliverLocal(appId, req.envelopeId, req.payload, req.retryAttempt);
        m.respond(new TextEncoder().encode(JSON.stringify({ result })));
      } catch {
        /* skip malformed; requester times out and the outbox retries */
      }
    }
  })();
}

function dropRouteSub(appId: string): void {
  routeSubs.get(appId)?.unsubscribe();
  routeSubs.delete(appId);
}

export function attachSocketMode(server: HttpServer): { close(): void } {
  const wss = new WebSocketServer({ noServer: true });
  routeUpgrade(server, '/api/socket-mode', wss);

  wss.on('connection', (sock: WebSocket, req: IncomingMessage) => {
    void (async () => {
      const ticket = new URL(req.url ?? '/', 'http://x').searchParams.get('ticket') ?? '';
      const appId = ticket ? await redeemSocketTicket(ticket).catch(() => null) : null;
      if (!appId) {
        sock.close(4001, 'invalid_ticket');
        return;
      }
      let set = connections.get(appId);
      if (!set) connections.set(appId, (set = new Set()));
      set.add(sock);
      ensureRouteSub(appId);

      sock.send(
        JSON.stringify({
          type: 'hello',
          num_connections: set.size,
          debug_info: { host: 'flow', approximate_connection_time: Math.floor(Date.now() / 1000) },
          connection_info: { app_id: appId },
        }),
      );

      const ping = setInterval(() => {
        if (sock.readyState === WebSocket.OPEN) sock.ping();
      }, PING_INTERVAL_MS);

      sock.on('message', (raw) => {
        let frame: { envelope_id?: string };
        try {
          frame = JSON.parse(String(raw)) as { envelope_id?: string };
        } catch {
          return;
        }
        if (frame.envelope_id) pendingAcks.get(frame.envelope_id)?.();
      });

      sock.on('close', () => {
        clearInterval(ping);
        set.delete(sock);
        if (set.size === 0) {
          connections.delete(appId);
          dropRouteSub(appId);
        }
      });
      sock.on('error', () => sock.close());
    })();
  });

  return {
    close() {
      for (const set of connections.values()) for (const s of set) s.close(1001, 'server_shutdown');
      for (const appId of [...routeSubs.keys()]) dropRouteSub(appId);
      wss.close();
    },
  };
}
