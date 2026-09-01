// The APNs provider token (#250). Signed for real with a P-256 key generated
// here and verified for real with `jose` — no fixture JWT, because a fixture
// only proves the string didn't change, and what matters is that Apple's
// verifier would accept what we produce.
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import { decodeProtectedHeader, importSPKI, jwtVerify } from 'jose';
import { apnsCredentials, apnsProviderToken, resetApnsProviderToken } from '../src/push/apnsAuth.js';

const saved = { key: process.env.FLOW_APNS_KEY, keyId: process.env.FLOW_APNS_KEY_ID, team: process.env.FLOW_APNS_TEAM_ID };

const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const spki = publicKey.export({ type: 'spki', format: 'pem' }).toString();

beforeEach(() => {
  resetApnsProviderToken();
  process.env.FLOW_APNS_KEY = Buffer.from(pem).toString('base64');
  process.env.FLOW_APNS_KEY_ID = 'ABCDE12345';
  process.env.FLOW_APNS_TEAM_ID = 'TEAM123456';
});

afterEach(() => {
  resetApnsProviderToken();
  for (const [k, v] of [['FLOW_APNS_KEY', saved.key], ['FLOW_APNS_KEY_ID', saved.keyId], ['FLOW_APNS_TEAM_ID', saved.team]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('APNs provider token', () => {
  it('signs an ES256 JWT Apple would accept', async () => {
    const jwt = await apnsProviderToken();
    expect(decodeProtectedHeader(jwt)).toMatchObject({ alg: 'ES256', kid: 'ABCDE12345' });
    // Real signature verification against the matching public key.
    const { payload } = await jwtVerify(jwt, await importSPKI(spki, 'ES256'), { issuer: 'TEAM123456' });
    expect(payload.iss).toBe('TEAM123456');
    expect(typeof payload.iat).toBe('number');
    // Apple's provider token carries no expiry of its own — the 60-minute
    // window is judged from `iat`, which is why we re-sign at 55.
    expect(payload.exp).toBeUndefined();
  });

  it('accepts the .p8 pasted in raw as well as base64', async () => {
    process.env.FLOW_APNS_KEY = pem;
    expect(apnsCredentials().keyPem).toContain('BEGIN PRIVATE KEY');
    await expect(apnsProviderToken()).resolves.toMatch(/^ey/);
  });

  it('caches for 55 minutes and re-signs past the window', async () => {
    const t0 = Date.UTC(2026, 8, 1, 12, 0, 0);
    const first = await apnsProviderToken(t0);
    // Same token 54 minutes later — Apple rate-limits a provider that re-signs
    // per request, so this is the property that keeps us out of trouble.
    expect(await apnsProviderToken(t0 + 54 * 60_000)).toBe(first);
    const later = await apnsProviderToken(t0 + 56 * 60_000);
    expect(later).not.toBe(first);
    // ...and the fresh one is still a valid token, not a mangled cache entry.
    const { payload } = await jwtVerify(later, await importSPKI(spki, 'ES256'));
    expect(payload.iat).toBe(Math.floor((t0 + 56 * 60_000) / 1000));
  });

  it('re-signs when the credentials change under the cache', async () => {
    const first = await apnsProviderToken();
    process.env.FLOW_APNS_KEY_ID = 'ZZZZZ99999';
    const second = await apnsProviderToken();
    expect(second).not.toBe(first);
    expect(decodeProtectedHeader(second).kid).toBe('ZZZZZ99999');
  });

  it('names exactly which env var is missing', () => {
    delete process.env.FLOW_APNS_KEY_ID;
    delete process.env.FLOW_APNS_TEAM_ID;
    expect(() => apnsCredentials()).toThrow(/FLOW_APNS_KEY_ID, FLOW_APNS_TEAM_ID/);
  });

  it('rejects a key that is neither PEM nor base64 of one', () => {
    process.env.FLOW_APNS_KEY = 'not-a-key';
    expect(() => apnsCredentials()).toThrow(/neither a PKCS#8 PEM nor base64/);
  });
});
