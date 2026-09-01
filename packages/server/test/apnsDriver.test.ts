// The real APNs driver (#250) against a real HTTP/2 server standing in for
// Apple.
//
// Not a mocked transport: `http2.createServer` speaks h2c, the driver's own
// `http2.connect` talks to it, and the assertions are on the bytes that
// crossed — the `:path`, the `apns-*` headers, and which of the two hosts the
// request went to. A mock would have proved that the driver calls a function.
//
// The status-code table in PUSH_APNS.md § "Token lifecycle and error handling"
// is the spec, so it is tested row by row: the two booleans the outbox worker
// reads (`retryable`, `disableDevice`) are the entire contract between this
// driver and the delivery policy above it.
import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import http2 from 'node:http2';
import { ApnsHttp2PushSender } from '../src/push/apnsSender.js';
import { closeApnsSessions } from '../src/push/apnsClient.js';
import type { ApnsHeaders, ApnsPayload, PushDevice } from '../src/push/types.js';

interface Seen {
  headers: http2.IncomingHttpHeaders;
  body: string;
  origin: 'production' | 'sandbox';
}

/** What the next request gets back; the test sets it before each send. */
let reply: { status: number; body?: string } = { status: 200 };
let seen: Seen[] = [];
/** Set to make the fake send GOAWAY right after its next response. */
let goawayAfterNext = false;
/** Live h2c sessions the fake has accepted — the session-reuse assertion. */
const accepted = { production: 0, sandbox: 0 };

function fakeApple(which: 'production' | 'sandbox') {
  const server = http2.createServer();
  server.on('session', () => {
    accepted[which] += 1;
  });
  server.on('stream', (stream, headers) => {
    let body = '';
    stream.setEncoding('utf8');
    stream.on('data', (c) => {
      body += c;
    });
    stream.on('end', () => {
      seen.push({ headers, body, origin: which });
      const res: Record<string, string | number> = { ':status': reply.status, 'apns-id': 'AAAA-BBBB' };
      if (reply.body === undefined) stream.respond(res, { endStream: true });
      else {
        stream.respond({ ...res, 'content-type': 'application/json' });
        stream.end(reply.body);
      }
      if (goawayAfterNext) {
        goawayAfterNext = false;
        stream.session?.goaway();
      }
    });
  });
  return server;
}

const servers = { production: fakeApple('production'), sandbox: fakeApple('sandbox') };
let origins: { production: string; sandbox: string };

beforeAll(async () => {
  await Promise.all(
    (['production', 'sandbox'] as const).map(
      (k) => new Promise<void>((r) => servers[k].listen(0, '127.0.0.1', r)),
    ),
  );
  const port = (k: 'production' | 'sandbox') => (servers[k].address() as { port: number }).port;
  origins = { production: `http://127.0.0.1:${port('production')}`, sandbox: `http://127.0.0.1:${port('sandbox')}` };
});

afterAll(async () => {
  closeApnsSessions();
  await Promise.all((['production', 'sandbox'] as const).map((k) => new Promise<void>((r) => servers[k].close(() => r()))));
});

beforeEach(() => {
  seen = [];
  reply = { status: 200 };
  goawayAfterNext = false;
});

/** A driver with a stub signer — no `.p8` needed to exercise the wire. */
const sender = () => new ApnsHttp2PushSender({ origins, signer: async () => 'test.jwt.sig', log: { warn: () => {}, error: () => {} } });

const device: PushDevice = {
  token: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
  platform: 'ios',
  environment: 'production',
  bundleId: 'im.freeflow.app',
};

const payload: ApnsPayload = {
  aps: { alert: { title: 'Alice (DM)', body: 'standup in 5?' }, sound: 'default', badge: 7, 'thread-id': 'chan-1' },
  workspaceId: 'ws-1',
  channelId: 'chan-1',
  messageId: 'msg-1',
  notificationId: 'notif-1',
};

const alert: ApnsHeaders = { pushType: 'alert', priority: 10, expiration: 1_800_000_000, collapseId: 'chan-1' };

describe('APNs driver — the wire', () => {
  it('POSTs /3/device/<token> with the apns-* headers and the payload', async () => {
    const r = await sender().send(device, payload, alert);
    expect(r).toEqual({ ok: true, apnsId: 'AAAA-BBBB' });
    expect(seen).toHaveLength(1);
    const h = seen[0]!.headers;
    expect(h[':method']).toBe('POST');
    expect(h[':path']).toBe(`/3/device/${device.token}`);
    expect(h.authorization).toBe('bearer test.jwt.sig');
    expect(h['apns-topic']).toBe('im.freeflow.app');
    expect(h['apns-push-type']).toBe('alert');
    expect(h['apns-priority']).toBe('10');
    expect(h['apns-expiration']).toBe('1800000000');
    expect(h['apns-collapse-id']).toBe('chan-1');
    expect(JSON.parse(seen[0]!.body)).toEqual(payload);
  });

  it('defaults a background push to priority 5 and sends no collapse id', async () => {
    await sender().send(device, { aps: { 'content-available': 1, badge: 3 } }, { pushType: 'background' });
    const h = seen[0]!.headers;
    expect(h['apns-push-type']).toBe('background');
    expect(h['apns-priority']).toBe('5');
    expect(h['apns-collapse-id']).toBeUndefined();
    expect(h['apns-expiration']).toBeUndefined();
  });

  it('sends a device with no bundleId under the configured topic', async () => {
    await sender().send({ token: 'ff00', platform: 'ios', environment: 'production' }, payload, alert);
    expect(seen[0]!.headers['apns-topic']).toBe('im.freeflow.app');
  });
});

describe('APNs driver — sandbox vs production', () => {
  it("sends to the host the DEVICE's environment names, not the config's", async () => {
    // The TestFlight trap: FLOW_APNS_ENV says production, but a locally signed
    // development build registered `sandbox` and must go to the sandbox host.
    const savedEnv = process.env.FLOW_APNS_ENV;
    process.env.FLOW_APNS_ENV = 'production';
    try {
      await sender().send({ ...device, environment: 'sandbox' }, payload, alert);
      expect(seen[0]!.origin).toBe('sandbox');
      await sender().send({ ...device, environment: 'production' }, payload, alert);
      expect(seen[1]!.origin).toBe('production');
    } finally {
      if (savedEnv === undefined) delete process.env.FLOW_APNS_ENV;
      else process.env.FLOW_APNS_ENV = savedEnv;
    }
  });

  it('falls back to FLOW_APNS_ENV only when the row carries none', async () => {
    const savedEnv = process.env.FLOW_APNS_ENV;
    process.env.FLOW_APNS_ENV = 'production';
    try {
      await sender().send({ token: 'ff00', platform: 'ios' }, payload, alert);
      expect(seen[0]!.origin).toBe('production');
    } finally {
      if (savedEnv === undefined) delete process.env.FLOW_APNS_ENV;
      else process.env.FLOW_APNS_ENV = savedEnv;
    }
  });
});

describe('APNs driver — the error table is the spec', () => {
  const cases: Array<[string, number, string | undefined, { retryable: boolean; disableDevice: boolean }]> = [
    ['410 Unregistered disables the device, never retries', 410, '{"reason":"Unregistered"}', { retryable: false, disableDevice: true }],
    ['400 BadDeviceToken disables the device, never retries', 400, '{"reason":"BadDeviceToken"}', { retryable: false, disableDevice: true }],
    ['400 DeviceTokenNotForTopic disables the device', 400, '{"reason":"DeviceTokenNotForTopic"}', { retryable: false, disableDevice: true }],
    ['403 InvalidProviderToken burns no retries and disables nothing', 403, '{"reason":"InvalidProviderToken"}', { retryable: false, disableDevice: false }],
    ['403 MissingProviderToken burns no retries', 403, '{"reason":"MissingProviderToken"}', { retryable: false, disableDevice: false }],
    ['429 TooManyRequests retries', 429, '{"reason":"TooManyRequests"}', { retryable: true, disableDevice: false }],
    ['500 retries', 500, '{"reason":"InternalServerError"}', { retryable: true, disableDevice: false }],
    ['503 retries', 503, undefined, { retryable: true, disableDevice: false }],
    ['400 BadCollapseId is our bug — dropped', 400, '{"reason":"BadCollapseId"}', { retryable: false, disableDevice: false }],
    ['413 PayloadTooLarge is our bug — dropped', 413, '{"reason":"PayloadTooLarge"}', { retryable: false, disableDevice: false }],
    ['404 is permanent', 404, undefined, { retryable: false, disableDevice: false }],
  ];

  for (const [name, status, body, expected] of cases) {
    it(name, async () => {
      reply = body === undefined ? { status } : { status, body };
      const r = await sender().send(device, payload, alert);
      expect(r.ok).toBe(false);
      expect(r).toMatchObject({ status, ...expected });
    });
  }

  it('reports the reason string so the worker log names the cause', async () => {
    reply = { status: 410, body: '{"reason":"Unregistered","timestamp":1735689600000}' };
    const r = await sender().send(device, payload, alert);
    expect(r).toMatchObject({ ok: false, reason: 'Unregistered' });
  });

  it('logs the operator alarm on 403, once, with the key id', async () => {
    reply = { status: 403, body: '{"reason":"InvalidProviderToken"}' };
    const errors: unknown[] = [];
    const s = new ApnsHttp2PushSender({ origins, signer: async () => 'jwt', log: { warn: () => {}, error: (o) => errors.push(o) } });
    await s.send(device, payload, alert);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ reason: 'InvalidProviderToken' });
  });

  it('logs our own bad request with the payload, and never the bearer token', async () => {
    reply = { status: 400, body: '{"reason":"BadCollapseId"}' };
    const warns: Array<Record<string, unknown>> = [];
    const s = new ApnsHttp2PushSender({ origins, signer: async () => 'jwt', log: { warn: (o) => warns.push(o as Record<string, unknown>), error: () => {} } });
    await s.send(device, payload, alert);
    expect(warns[0]).toMatchObject({ reason: 'BadCollapseId', payload });
    expect((warns[0]!.headers as Record<string, string>).authorization).toBe('<redacted>');
  });

  it('re-signs rather than alarming on an expired provider token', async () => {
    reply = { status: 403, body: '{"reason":"ExpiredProviderToken"}' };
    const errors: unknown[] = [];
    const s = new ApnsHttp2PushSender({ origins, signer: async () => 'jwt', log: { warn: () => {}, error: (o) => errors.push(o) } });
    const r = await s.send(device, payload, alert);
    // Transient, not an alarm: our clock drifted past Apple's 60-minute window.
    expect(r).toMatchObject({ ok: false, retryable: true, disableDevice: false });
    expect(errors).toHaveLength(0);
  });
});

describe('APNs driver — the session pool', () => {
  it('multiplexes many sends over one connection per host', async () => {
    closeApnsSessions();
    // Let the fake settle the closed sessions before counting new ones.
    await new Promise((r) => setTimeout(r, 50));
    const before = { ...accepted };
    const s = sender();
    await Promise.all(Array.from({ length: 8 }, () => s.send(device, payload, alert)));
    expect(seen).toHaveLength(8);
    expect(accepted.production - before.production).toBe(1);
  });

  it('reconnects on GOAWAY instead of writing into a retiring session', async () => {
    const s = sender();
    // Apple retires connections routinely — before maintenance, and on a whim.
    goawayAfterNext = true;
    expect((await s.send(device, payload, alert)).ok).toBe(true);
    const before = accepted.production;
    await new Promise((r) => setTimeout(r, 50)); // let the GOAWAY land and evict
    const r2 = await s.send(device, payload, alert);
    expect(r2.ok).toBe(true);
    expect(accepted.production).toBe(before + 1);
  });

  it('treats an unreachable host as transient, never as a dead token', async () => {
    const s = new ApnsHttp2PushSender({
      origins: { production: 'http://127.0.0.1:1', sandbox: 'http://127.0.0.1:1' },
      signer: async () => 'jwt',
      log: { warn: () => {}, error: () => {} },
    });
    const r = await s.send(device, payload, alert);
    expect(r).toMatchObject({ ok: false, retryable: true, disableDevice: false });
    expect((r as { reason: string }).reason).toMatch(/transport:/);
  });
});
