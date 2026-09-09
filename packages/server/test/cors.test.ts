// CORS allowlist for packaged clients (docs/design/ANDROID.md, phase 0).
//
// The web client is served by this process and is same-origin, so the server
// has never needed a CORS layer — and a pure-web deployment still must not get
// one. The cases that matter: nothing at all happens unless FLOW_CORS_ORIGINS is
// set; when it is, only the listed origins are reflected; and a preflight for
// an authenticated PATCH succeeds, since that is what a packaged client does
// on every second request.
//
// Driven through env + buildApp(), no database — the plugin answers at
// onRequest, and the probe route (/v1/config) reads only config.
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

process.env.FLOW_DATA_KEY ??= randomBytes(32).toString('base64');

const { buildApp } = await import('../src/app.js');

const APP = 'capacitor://localhost';
const OTHER = 'https://evil.example';

const saved = process.env.FLOW_CORS_ORIGINS;

/** buildApp() reads config at construction, so each case gets a fresh app. */
async function appWith(origins: string | undefined): Promise<FastifyInstance> {
  if (origins === undefined) delete process.env.FLOW_CORS_ORIGINS;
  else process.env.FLOW_CORS_ORIGINS = origins;
  const app = buildApp();
  await app.ready();
  return app;
}

beforeEach(() => {
  process.env.LOG_LEVEL = 'silent';
});

afterEach(() => {
  if (saved === undefined) delete process.env.FLOW_CORS_ORIGINS;
  else process.env.FLOW_CORS_ORIGINS = saved;
});

describe('CORS allowlist', () => {
  it('is absent unless FLOW_CORS_ORIGINS is set — a web deployment is untouched', async () => {
    const app = await appWith(undefined);
    const res = await app.inject({ method: 'GET', url: '/v1/config', headers: { origin: APP } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    // No plugin means no preflight handler either: OPTIONS is just an
    // unrouted method, not a silent 204 that would mislead a probe.
    const pre = await app.inject({
      method: 'OPTIONS',
      url: '/v1/me',
      headers: { origin: APP, 'access-control-request-method': 'PATCH' },
    });
    expect(pre.statusCode).not.toBe(204);
    await app.close();
  });

  it('reflects an allowlisted origin, and only that origin', async () => {
    const app = await appWith(APP);
    const ok = await app.inject({ method: 'GET', url: '/v1/config', headers: { origin: APP } });
    expect(ok.headers['access-control-allow-origin']).toBe(APP);
    // Vary is what keeps a shared cache from handing the allowlisted answer
    // to a different origin.
    expect(String(ok.headers.vary ?? '').toLowerCase()).toContain('origin');

    const no = await app.inject({ method: 'GET', url: '/v1/config', headers: { origin: OTHER } });
    expect(no.statusCode).toBe(200); // the request itself is served; the browser withholds it
    expect(no.headers['access-control-allow-origin']).toBeUndefined();
    await app.close();
  });

  it('answers a preflight for an authenticated PATCH', async () => {
    const app = await appWith(APP);
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/v1/me',
      headers: {
        origin: APP,
        'access-control-request-method': 'PATCH',
        'access-control-request-headers': 'authorization, content-type',
      },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(APP);
    expect(String(res.headers['access-control-allow-methods'])).toContain('PATCH');
    expect(String(res.headers['access-control-allow-headers']).toLowerCase()).toContain('authorization');
    await app.close();
  });

  it('never grants credentials — auth is a Bearer header, not a cookie', async () => {
    const app = await appWith(APP);
    const res = await app.inject({ method: 'GET', url: '/v1/config', headers: { origin: APP } });
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    await app.close();
  });

  it('accepts a comma-separated list, trimming blanks and case', async () => {
    const app = await appWith(` ${APP.toUpperCase()} , , https://localhost `);
    for (const origin of [APP, 'https://localhost']) {
      const res = await app.inject({ method: 'GET', url: '/v1/config', headers: { origin } });
      expect(res.headers['access-control-allow-origin'], origin).toBe(origin);
    }
    await app.close();
  });
});
