import { beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  _resetCryptoForTests,
  decryptBody,
  encryptBody,
  initCrypto,
  SCHEME_AES_256_GCM_V1,
} from '../src/crypto/index.js';

beforeAll(() => {
  process.env.MYCHAT_DATA_KEY = randomBytes(32).toString('base64');
  // config reads env at import time in the running app; for tests we reset and re-init
  _resetCryptoForTests();
});

describe('envelope encryption (aes-256-gcm-v1)', () => {
  it('round-trips utf8 plaintext', () => {
    const enc = encryptBody('hello **world** — émoji 🎉');
    expect(enc.encScheme).toBe(SCHEME_AES_256_GCM_V1);
    expect(enc.bodyNonce.length).toBe(12);
    expect(decryptBody(enc)).toBe('hello **world** — émoji 🎉');
  });

  it('ciphertext does not contain plaintext', () => {
    const enc = encryptBody('supersecretplaintext');
    expect(enc.body.toString('utf8')).not.toContain('supersecretplaintext');
    expect(enc.body.toString('latin1')).not.toContain('supersecretplaintext');
  });

  it('uses a fresh nonce per encryption and distinct ciphertexts', () => {
    const a = encryptBody('same message');
    const b = encryptBody('same message');
    expect(a.bodyNonce.equals(b.bodyNonce)).toBe(false);
    expect(a.body.equals(b.body)).toBe(false);
  });

  it('rejects tampered ciphertext (GCM auth)', () => {
    const enc = encryptBody('integrity matters');
    const tampered = Buffer.from(enc.body);
    tampered[0] = tampered[0]! ^ 0xff;
    expect(() => decryptBody({ ...enc, body: tampered })).toThrow();
  });

  it('rejects unknown key ids', () => {
    const enc = encryptBody('x');
    expect(() => decryptBody({ ...enc, encKeyId: 'nope' })).toThrow(/unknown enc_key_id/);
  });

  it('supports scheme 0 plaintext rows (dev only)', () => {
    expect(
      decryptBody({ body: Buffer.from('plain'), bodyNonce: Buffer.alloc(0), encKeyId: 'n/a', encScheme: 0 }),
    ).toBe('plain');
  });

  it('empty ciphertext round-trip (soft delete overwrite)', () => {
    initCrypto();
    const enc = encryptBody('');
    expect(decryptBody(enc)).toBe('');
  });
});
