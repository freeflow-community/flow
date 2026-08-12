// GET /v1/config — the public bootstrap payload.
//
// `maxFileBytes` is here so a client can refuse an over-size file *before* the
// presign round trip and tell the user what the limit is (issue #219). The
// point of the test is that the number a client reads is the same number
// `createPresignedUpload` enforces: a client that hardcodes 500 MB goes wrong
// the day a deployment sets FLOW_MAX_FILE_MB, and it goes wrong silently.
//
// No database — the route is pure config, like the redirect hook tests.
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';

process.env.FLOW_DATA_KEY ??= randomBytes(32).toString('base64');

const { buildApp } = await import('../src/app.js');
const { config } = await import('../src/config.js');

const saved = process.env.FLOW_MAX_FILE_MB;

beforeEach(() => {
  process.env.LOG_LEVEL = 'silent';
});

afterEach(() => {
  if (saved === undefined) delete process.env.FLOW_MAX_FILE_MB;
  else process.env.FLOW_MAX_FILE_MB = saved;
});

async function publicConfig() {
  const app = buildApp();
  const res = await app.inject({ method: 'GET', url: '/v1/config' });
  await app.close();
  expect(res.statusCode).toBe(200);
  return res.json();
}

describe('GET /v1/config', () => {
  it('publishes the upload limit, defaulting to 500 MB', async () => {
    delete process.env.FLOW_MAX_FILE_MB;
    expect((await publicConfig()).maxFileBytes).toBe(500 * 1024 * 1024);
  });

  it('follows FLOW_MAX_FILE_MB, and matches what presign enforces', async () => {
    process.env.FLOW_MAX_FILE_MB = '25';
    const body = await publicConfig();
    expect(body.maxFileBytes).toBe(25 * 1024 * 1024);
    expect(body.maxFileBytes).toBe(config.maxFileBytes);
  });

  it('still carries the auth flags it was added for', async () => {
    const body = await publicConfig();
    expect(body).toHaveProperty('google');
    expect(body).toHaveProperty('googleClientId');
    expect(body).toHaveProperty('apple');
  });
});
