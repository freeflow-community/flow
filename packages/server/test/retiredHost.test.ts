// Retired-hostname redirect (phase17 §13).
//
// After a re-domain the old hostname still resolves to this same service, so
// the redirect keys off the Host header. The interesting cases are the
// *exemptions*: redirecting the API would break old clients in ways that look
// like an outage rather than a migration, so /v1 and /api must pass through
// untouched while everything else moves.
//
// Driven entirely through env + buildApp(), no database — the hook runs at
// onRequest, before routing.
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

process.env.FLOW_DATA_KEY ??= randomBytes(32).toString('base64');

const { buildApp } = await import('../src/app.js');

const OLD = 'app.flowtoo.org';
const NEW = 'https://app.freeflow.im';

const saved = {
  hosts: process.env.FLOW_REDIRECT_FROM_HOSTS,
  web: process.env.FLOW_WEB_URL,
};

/** buildApp() reads config at construction, so each case gets a fresh app. */
function appWith(hosts: string | undefined, webUrl = NEW): FastifyInstance {
  if (hosts === undefined) delete process.env.FLOW_REDIRECT_FROM_HOSTS;
  else process.env.FLOW_REDIRECT_FROM_HOSTS = hosts;
  process.env.FLOW_WEB_URL = webUrl;
  return buildApp();
}

beforeEach(() => {
  process.env.LOG_LEVEL = 'silent';
});

afterEach(() => {
  if (saved.hosts === undefined) delete process.env.FLOW_REDIRECT_FROM_HOSTS;
  else process.env.FLOW_REDIRECT_FROM_HOSTS = saved.hosts;
  if (saved.web === undefined) delete process.env.FLOW_WEB_URL;
  else process.env.FLOW_WEB_URL = saved.web;
});

describe('retired-hostname redirect', () => {
  it('is off unless FLOW_REDIRECT_FROM_HOSTS is set — self-hosters pay nothing', async () => {
    const app = appWith(undefined);
    const res = await app.inject({ method: 'GET', url: '/', headers: { host: OLD } });
    expect(res.statusCode).not.toBe(302);
    await app.close();
  });

  it('302s a browser request, preserving path AND query', async () => {
    const app = appWith(OLD);
    // The query matters: emailed signup links (/?signup=<token>) with the old
    // host are still in inboxes, and dropping the token breaks the flow.
    const res = await app.inject({
      method: 'GET',
      url: '/?signup=tok123&x=1',
      headers: { host: OLD },
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`${NEW}/?signup=tok123&x=1`);
    await app.close();
  });

  it('leaves the canonical host alone', async () => {
    const app = appWith(OLD);
    const res = await app.inject({
      method: 'GET',
      url: '/',
      headers: { host: 'app.freeflow.im' },
    });
    expect(res.statusCode).not.toBe(302);
    await app.close();
  });

  it('exempts /v1 and /api — a 302 would replay POSTs as GETs and kill /v1/ws', async () => {
    const app = appWith(OLD);
    for (const url of ['/v1/config', '/v1/ws', '/v1/auth/register', '/api/auth.test']) {
      const res = await app.inject({ method: 'GET', url, headers: { host: OLD } });
      expect(res.statusCode, `${url} must not redirect`).not.toBe(302);
    }
    await app.close();
  });

  it('redirects /download — this is how an installed Mac app finds the new appcast', async () => {
    const app = appWith(OLD);
    const res = await app.inject({
      method: 'GET',
      url: '/download/mac/appcast.xml',
      headers: { host: OLD },
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`${NEW}/download/mac/appcast.xml`);
    await app.close();
  });

  it('accepts a comma-separated list, case-insensitively, ignoring blanks', async () => {
    const app = appWith(` ${OLD.toUpperCase()} , , old.example.com `);
    for (const host of [OLD, 'old.example.com']) {
      const res = await app.inject({ method: 'GET', url: '/', headers: { host } });
      expect(res.statusCode, host).toBe(302);
    }
    await app.close();
  });

  it('refuses to redirect the canonical host to itself (loop guard)', async () => {
    // A fat-fingered variable that listed the live host would otherwise take
    // the whole service down with an infinite redirect.
    const app = appWith('app.freeflow.im');
    const res = await app.inject({
      method: 'GET',
      url: '/',
      headers: { host: 'app.freeflow.im' },
    });
    expect(res.statusCode).not.toBe(302);
    await app.close();
  });

  it('strips a port from the Host header before matching', async () => {
    const app = appWith(OLD);
    const res = await app.inject({ method: 'GET', url: '/', headers: { host: `${OLD}:8080` } });
    expect(res.statusCode).toBe(302);
    await app.close();
  });
});
