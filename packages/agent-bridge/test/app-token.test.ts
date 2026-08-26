// Mini-app token verification (docs/design/MINI_APPS.md, issue #370). The
// guard's verifier is a standalone reimplementation of the server's signer, so
// these tests sign with the *documented recipe* — base64url(payloadJson) "."
// base64url(hmacSha256(secret, payloadJson)) — rather than importing server
// code. If the two ever drift, this file is where it shows.
import { describe, expect, it } from 'vitest';
import { createHmac, randomBytes } from 'node:crypto';
import {
  APP_TOKEN_TTL_SECONDS,
  JtiStore,
  decodeAppSecret,
  verifyAppToken,
  verifyAppTokenAny,
  type AppTokenPayload,
} from '../src/app-token.js';

const SECRET = randomBytes(32);
const NOW = new Date('2026-08-26T12:00:00Z');

function payload(over: Partial<AppTokenPayload> = {}): AppTokenPayload {
  const iat = Math.floor(NOW.getTime() / 1000);
  return {
    v: 1,
    artifactId: 'art-1',
    channelId: 'chan-1',
    workspaceId: 'ws-1',
    userId: 'user-1',
    displayName: 'Scott',
    isAgent: false,
    iat,
    exp: iat + APP_TOKEN_TTL_SECONDS,
    jti: 'jti-1',
    ...over,
  };
}

/** The signing half, written out from the spec — not imported. */
function sign(secret: Buffer, p: AppTokenPayload): string {
  const json = Buffer.from(JSON.stringify(p), 'utf8');
  const mac = createHmac('sha256', secret).update(json).digest();
  return `${json.toString('base64url')}.${mac.toString('base64url')}`;
}

describe('verifyAppToken', () => {
  it('accepts a well-formed token and returns the identity', () => {
    const got = verifyAppToken(SECRET, sign(SECRET, payload()), NOW);
    expect(got).toMatchObject({ userId: 'user-1', displayName: 'Scott', isAgent: false, channelId: 'chan-1' });
  });

  it('rejects a token signed by a different secret', () => {
    expect(verifyAppToken(SECRET, sign(randomBytes(32), payload()), NOW)).toBeNull();
  });

  it('rejects a tampered payload (the signature covers the bytes that travelled)', () => {
    const token = sign(SECRET, payload());
    const [body, mac] = token.split('.') as [string, string];
    const forged = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as AppTokenPayload;
    forged.userId = 'someone-else';
    const swapped = `${Buffer.from(JSON.stringify(forged), 'utf8').toString('base64url')}.${mac}`;
    expect(verifyAppToken(SECRET, swapped, NOW)).toBeNull();
  });

  it('rejects an expired token', () => {
    const token = sign(SECRET, payload());
    const late = new Date(NOW.getTime() + (APP_TOKEN_TTL_SECONDS + 1) * 1000);
    expect(verifyAppToken(SECRET, token, late)).toBeNull();
    // still good one second before exp
    expect(verifyAppToken(SECRET, token, new Date(NOW.getTime() + (APP_TOKEN_TTL_SECONDS - 1) * 1000))).not.toBeNull();
  });

  it('rejects malformed tokens without throwing', () => {
    const good = sign(SECRET, payload());
    const body = good.split('.')[0]!;
    for (const bad of ['', '.', 'nodot', `${body}`, `.${body}`, `${body}.`, `${body}.x.y`, `${body}.!!!!`]) {
      expect(verifyAppToken(SECRET, bad, NOW)).toBeNull();
    }
    // valid signature over non-JSON, and over JSON that isn't a payload
    const junk = Buffer.from('not json', 'utf8');
    const junkMac = createHmac('sha256', SECRET).update(junk).digest();
    expect(verifyAppToken(SECRET, `${junk.toString('base64url')}.${junkMac.toString('base64url')}`, NOW)).toBeNull();
  });

  it('rejects an unknown format version and a missing jti', () => {
    expect(verifyAppToken(SECRET, sign(SECRET, payload({ v: 2 as 1 })), NOW)).toBeNull();
    expect(verifyAppToken(SECRET, sign(SECRET, payload({ jti: '' })), NOW)).toBeNull();
  });

  it('carries isAgent through for agent viewers', () => {
    const got = verifyAppToken(SECRET, sign(SECRET, payload({ isAgent: true, displayName: 'Builder' })), NOW);
    expect(got).toMatchObject({ isAgent: true, displayName: 'Builder' });
  });
});

describe('verifyAppTokenAny', () => {
  it('accepts a token from any configured secret (one artifact per channel)', () => {
    const other = randomBytes(32);
    const secrets = [SECRET, other];
    expect(verifyAppTokenAny(secrets, sign(other, payload({ channelId: 'chan-2' })), NOW)).toMatchObject({
      channelId: 'chan-2',
    });
    expect(verifyAppTokenAny(secrets, sign(SECRET, payload()), NOW)).not.toBeNull();
    expect(verifyAppTokenAny(secrets, sign(randomBytes(32), payload()), NOW)).toBeNull();
  });
});

describe('decodeAppSecret', () => {
  it('round-trips the base64url secret the server hands out', () => {
    expect(decodeAppSecret(SECRET.toString('base64url')).equals(SECRET)).toBe(true);
    expect(decodeAppSecret(` ${SECRET.toString('base64url')} `).equals(SECRET)).toBe(true);
  });

  it('throws on an empty secret rather than silently accepting nothing', () => {
    expect(() => decodeAppSecret('   ')).toThrow();
  });
});

describe('JtiStore', () => {
  it('burns a jti once and rejects the replay', () => {
    const store = new JtiStore();
    const exp = Math.floor(NOW.getTime() / 1000) + APP_TOKEN_TTL_SECONDS;
    expect(store.burn('a', exp, NOW)).toBe(true);
    expect(store.burn('a', exp, NOW)).toBe(false);
    expect(store.burn('b', exp, NOW)).toBe(true);
  });

  it('forgets jtis once their tokens would have expired anyway', () => {
    const store = new JtiStore();
    const exp = Math.floor(NOW.getTime() / 1000) + APP_TOKEN_TTL_SECONDS;
    store.burn('a', exp, NOW);
    expect(store.size).toBe(1);
    // past exp the entry is swept — the token is dead on its own by then
    const later = new Date(NOW.getTime() + (APP_TOKEN_TTL_SECONDS + 1) * 1000);
    store.burn('c', Math.floor(later.getTime() / 1000) + APP_TOKEN_TTL_SECONDS, later);
    expect(store.size).toBe(1);
  });
});
