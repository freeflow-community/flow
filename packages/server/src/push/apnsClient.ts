// One long-lived HTTP/2 session per APNs host (#250, PUSH_APNS.md § "The
// sender seam").
//
// APNs is HTTP/2-only and expects a provider to hold a connection open and
// multiplex requests over it — a session per push is the documented way to get
// throttled, on top of paying a TLS handshake per notification. So sessions
// live in module state, keyed by origin, and are evicted the moment they stop
// being usable: `GOAWAY` (Apple retires a connection routinely, and always
// before maintenance), a transport error, or a plain close. Eviction is all
// the reconnect logic there is — the next send finds no session and dials a
// new one, which is also why nothing here needs a reconnect timer or backoff.
//
// Both environments can be live at once (the per-device `environment` column),
// so the map holds up to two sessions rather than one.
import http2 from 'node:http2';

/** Apple's two front doors. Sandbox serves development builds only. */
export const APNS_ORIGINS = {
  production: 'https://api.push.apple.com',
  sandbox: 'https://api.sandbox.push.apple.com',
} as const;

export type ApnsOrigins = Record<'production' | 'sandbox', string>;

/** A request that neither completed nor failed inside this is a transient. */
const REQUEST_TIMEOUT_MS = 10_000;

export interface ApnsResponse {
  status: number;
  /** Apple's per-notification id, echoed for support tickets. */
  apnsId?: string | undefined;
  /** `{"reason":"BadDeviceToken"}` for anything but a 200. */
  reason?: string | undefined;
  /** Raw body, kept for the log line when `reason` doesn't parse. */
  body: string;
}

const sessions = new Map<string, http2.ClientHttp2Session>();
/** Requests in flight per session — an idle session is unref'd, a busy one isn't. */
const inFlight = new WeakMap<http2.ClientHttp2Session, number>();

/**
 * Hold the process open exactly as long as a push is actually on the wire.
 *
 * An idle pooled session must not keep node alive (the same reason the outbox
 * worker unrefs its interval), but an unref'd session with a request in flight
 * lets the process exit mid-push — which in a short-lived process is a
 * silently dropped notification, and the hardest kind to notice.
 */
function retain(session: http2.ClientHttp2Session): void {
  const n = (inFlight.get(session) ?? 0) + 1;
  inFlight.set(session, n);
  if (n === 1) session.ref();
}

function release(session: http2.ClientHttp2Session): void {
  const n = Math.max(0, (inFlight.get(session) ?? 0) - 1);
  inFlight.set(session, n);
  if (n === 0) session.unref();
}

/**
 * The live session for an origin, dialling one if there isn't a usable one.
 *
 * `destroyed`/`closed` are checked as well as presence because a session can
 * die between the eviction handler being registered and the next send — the
 * handlers below cover the ordinary path, this covers the race.
 */
function sessionFor(origin: string): http2.ClientHttp2Session {
  const existing = sessions.get(origin);
  if (existing && !existing.destroyed && !existing.closed) return existing;
  const session = http2.connect(origin);
  sessions.set(origin, session);
  const evict = () => {
    if (sessions.get(origin) === session) sessions.delete(origin);
  };
  // GOAWAY is normal operation at Apple's scale, not a fault: it means "finish
  // what's in flight, then stop using me". Evicting here is what makes the
  // next send reconnect instead of writing into a closing session.
  session.on('goaway', evict);
  session.on('close', evict);
  session.on('error', evict);
  // Idle by default; `retain` refs it for as long as a request is in flight.
  session.unref();
  return session;
}

/** POST one notification. Rejects only on transport failure; any HTTP status resolves. */
export function apnsRequest(
  origin: string,
  path: string,
  headers: Record<string, string | number>,
  body: string,
): Promise<ApnsResponse> {
  return new Promise((resolve, reject) => {
    let session: http2.ClientHttp2Session;
    try {
      session = sessionFor(origin);
    } catch (err) {
      reject(err);
      return;
    }
    retain(session);
    const req = session.request({
      ':method': 'POST',
      ':path': path,
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
      ...headers,
    });
    let status = 0;
    let apnsId: string | undefined;
    let chunks = '';
    let settled = false;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      release(session);
      req.close(http2.constants.NGHTTP2_CANCEL);
      reject(err);
    };
    req.setEncoding('utf8');
    req.setTimeout(REQUEST_TIMEOUT_MS, () => fail(new Error(`APNs request timed out after ${REQUEST_TIMEOUT_MS}ms`)));
    req.on('response', (h) => {
      status = Number(h[':status'] ?? 0);
      const id = h['apns-id'];
      apnsId = Array.isArray(id) ? id[0] : id;
    });
    req.on('data', (c: string) => {
      chunks += c;
    });
    req.on('error', fail);
    req.on('end', () => {
      if (settled) return;
      settled = true;
      release(session);
      let reason: string | undefined;
      if (chunks) {
        try {
          reason = (JSON.parse(chunks) as { reason?: string }).reason;
        } catch {
          // Apple always sends JSON; a body that isn't is worth keeping raw
          // in the log rather than swallowing as an unparsed nothing.
        }
      }
      resolve({ status, apnsId, reason, body: chunks });
    });
    req.end(body);
  });
}

/** Tests and shutdown: drop every pooled session. */
export function closeApnsSessions(): void {
  for (const [origin, session] of sessions) {
    session.close();
    sessions.delete(origin);
  }
}
