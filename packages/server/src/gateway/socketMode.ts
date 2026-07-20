// Slack Socket Mode compatibility (see APPS.md): apps.connections.open mints
// a one-time ticket URL; the app's SocketModeClient connects here and events
// flow over the socket as {envelope_id, type:"events_api", payload} frames,
// acked by echoing {envelope_id}. The outbox in services/appEvents.ts stays
// the source of truth — this module is only the transport. Single-node by
// design (in-memory tickets + connections), like presence.
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { newToken } from '../lib/tokens.js';
import { routeUpgrade } from './upgrade.js';

const TICKET_TTL_MS = 60_000;
const ACK_TIMEOUT_MS = 3_000;
/** Slack SDK clients treat a silent server as a dead connection — keep pinging. */
const PING_INTERVAL_MS = 15_000;

const tickets = new Map<string, { appId: string; expiresAt: number }>();
const connections = new Map<string, Set<WebSocket>>();
const pendingAcks = new Map<string, () => void>();

/** One-time ticket for the wss URL returned by apps.connections.open. */
export function mintSocketTicket(appId: string): string {
  for (const [t, v] of tickets) if (v.expiresAt < Date.now()) tickets.delete(t);
  const ticket = newToken();
  tickets.set(ticket, { appId, expiresAt: Date.now() + TICKET_TTL_MS });
  return ticket;
}

export function hasLiveSocket(appId: string): boolean {
  return (connections.get(appId)?.size ?? 0) > 0;
}

/**
 * Send one events_api envelope over a live socket and await the client ack.
 * 'no_socket' lets the caller fall back to HTTP or leave the row queued.
 */
export function deliverEnvelope(
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

export function attachSocketMode(server: HttpServer): { close(): void } {
  const wss = new WebSocketServer({ noServer: true });
  routeUpgrade(server, '/api/socket-mode', wss);

  wss.on('connection', (sock: WebSocket, req: IncomingMessage) => {
    const ticket = new URL(req.url ?? '/', 'http://x').searchParams.get('ticket') ?? '';
    const entry = tickets.get(ticket);
    tickets.delete(ticket); // single-use, valid or not
    if (!entry || entry.expiresAt < Date.now()) {
      sock.close(4001, 'invalid_ticket');
      return;
    }
    const { appId } = entry;
    let set = connections.get(appId);
    if (!set) connections.set(appId, (set = new Set()));
    set.add(sock);

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
      if (set.size === 0) connections.delete(appId);
    });
    sock.on('error', () => sock.close());
  });

  return {
    close() {
      for (const set of connections.values()) for (const s of set) s.close(1001, 'server_shutdown');
      wss.close();
    },
  };
}
