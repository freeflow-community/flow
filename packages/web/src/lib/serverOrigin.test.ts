import { describe, expect, it } from 'vitest';
import {
  ServerOriginError,
  canonicalizeOrigin,
  isPlaintextLoopbackPage,
  isSameOrigin,
  originLabel,
  socketUrlFor,
  tryCanonicalizeOrigin,
} from './serverOrigin';

const secure = { allowInsecureLoopback: false };
const dev = { allowInsecureLoopback: true };

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return (e as ServerOriginError).code;
  }
  return 'no_throw';
}

describe('canonicalizeOrigin', () => {
  it('normalizes scheme, host case, default port and trailing slash', () => {
    expect(canonicalizeOrigin('https://Flow.Example.COM/', secure).origin).toBe('https://flow.example.com');
    expect(canonicalizeOrigin('https://flow.example.com:443', secure).origin).toBe('https://flow.example.com');
    expect(canonicalizeOrigin('HTTPS://flow.example.com', secure).origin).toBe('https://flow.example.com');
  });

  it('keeps a non-default port as the effective port', () => {
    const o = canonicalizeOrigin('https://flow.example.com:8443', secure);
    expect(o.origin).toBe('https://flow.example.com:8443');
    expect(o.effectivePort).toBe(8443);
  });

  it('reports the effective port even when it is the default', () => {
    expect(canonicalizeOrigin('https://flow.example.com', secure).effectivePort).toBe(443);
    expect(canonicalizeOrigin('http://127.0.0.1', dev).effectivePort).toBe(80);
  });

  it('defaults a bare host to https rather than rejecting it', () => {
    expect(canonicalizeOrigin('flow.example.com', secure).origin).toBe('https://flow.example.com');
  });

  it('rejects userinfo, query, fragment and non-root paths instead of trimming them', () => {
    expect(codeOf(() => canonicalizeOrigin('https://user:pw@flow.example.com', secure))).toBe(
      'userinfo_not_allowed',
    );
    expect(codeOf(() => canonicalizeOrigin('https://flow.example.com/?join=abc', secure))).toBe(
      'query_not_allowed',
    );
    expect(codeOf(() => canonicalizeOrigin('https://flow.example.com/#/x', secure))).toBe(
      'fragment_not_allowed',
    );
    expect(codeOf(() => canonicalizeOrigin('https://example.com/flow', secure))).toBe('path_not_allowed');
    expect(codeOf(() => canonicalizeOrigin('https://example.com/join/acme/tok', secure))).toBe(
      'path_not_allowed',
    );
  });

  it('requires https off loopback, and allows http on loopback only in dev', () => {
    expect(codeOf(() => canonicalizeOrigin('http://flow.example.com', dev))).toBe('insecure');
    expect(codeOf(() => canonicalizeOrigin('http://127.0.0.1:8787', secure))).toBe('insecure');
    expect(canonicalizeOrigin('http://127.0.0.1:8787', dev).origin).toBe('http://127.0.0.1:8787');
    expect(canonicalizeOrigin('http://localhost:5173', dev).origin).toBe('http://localhost:5173');
    // A private-network deployment over HTTPS is fine.
    expect(canonicalizeOrigin('https://192.168.1.9:8443', secure).origin).toBe('https://192.168.1.9:8443');
  });

  it('rejects non-http schemes and unparseable input', () => {
    expect(codeOf(() => canonicalizeOrigin('flow://signin?code=1', secure))).toBe('scheme_not_supported');
    expect(codeOf(() => canonicalizeOrigin('   ', secure))).toBe('empty');
    expect(codeOf(() => canonicalizeOrigin('https://', secure))).toBe('unparseable');
  });

  it('tryCanonicalizeOrigin returns null instead of throwing', () => {
    expect(tryCanonicalizeOrigin('https://example.com/flow', secure)).toBeNull();
    expect(tryCanonicalizeOrigin('https://example.com', secure)?.origin).toBe('https://example.com');
  });
});

describe('isSameOrigin', () => {
  const origin = 'https://flow.example.com';

  it('accepts the exact origin and relative paths resolved against it', () => {
    expect(isSameOrigin(origin, 'https://flow.example.com/v1/me')).toBe(true);
    expect(isSameOrigin(origin, '/v1/files/abc')).toBe(true);
    expect(isSameOrigin(origin, 'https://flow.example.com:443/v1/me')).toBe(true);
  });

  it('rejects a different scheme, host or port — the bearer must not follow', () => {
    expect(isSameOrigin(origin, 'http://flow.example.com/v1/me')).toBe(false);
    expect(isSameOrigin(origin, 'https://flow.example.com:8443/v1/me')).toBe(false);
    expect(isSameOrigin(origin, 'https://evil.example.com/v1/me')).toBe(false);
    // The shape a presigned storage URL actually arrives in.
    expect(isSameOrigin(origin, 'https://bucket.r2.cloudflarestorage.com/o?X-Amz-Signature=x')).toBe(false);
  });
});

describe('socketUrlFor / originLabel', () => {
  it('derives the ws endpoint from the owning origin', () => {
    expect(socketUrlFor('https://flow.example.com')).toBe('wss://flow.example.com/v1/ws');
    expect(socketUrlFor('http://127.0.0.1:8787')).toBe('ws://127.0.0.1:8787/v1/ws');
  });

  it('labels an origin without its scheme', () => {
    expect(originLabel('https://flow.example.com')).toBe('flow.example.com');
    expect(originLabel('http://127.0.0.1:8787')).toBe('127.0.0.1:8787');
  });
});

describe('insecure loopback (#542)', () => {
  const at = (href: string) => {
    const url = new URL(href);
    return isPlaintextLoopbackPage(url.protocol, url.hostname);
  };

  it('lets a page served over plaintext loopback connect to another one', () => {
    // `pnpm dev` and `pnpm qa:up` both serve a *built* bundle, so the Vite dev
    // flag is false there. Without this clause the multi-server flow was the
    // one feature nobody could try locally in a browser at all.
    expect(at('http://127.0.0.1:8787/')).toBe(true);
    expect(at('http://localhost:5173/')).toBe(true);
    expect(at('http://[::1]:8787/')).toBe(true);
    expect(canonicalizeOrigin('http://127.0.0.1:54610', { allowInsecureLoopback: true }).origin)
      .toBe('http://127.0.0.1:54610');
  });

  it('refuses plaintext from a deployed page, loopback address included', () => {
    expect(at('https://app.freeflow.im/')).toBe(false);
    // https page, so the loopback carve-out is off — and a plaintext backend
    // is refused whatever its host.
    expect(() => canonicalizeOrigin('http://127.0.0.1:8787', { allowInsecureLoopback: false }))
      .toThrow(ServerOriginError);
    expect(() => canonicalizeOrigin('http://flow.example.com', { allowInsecureLoopback: false }))
      .toThrow(ServerOriginError);
  });

  it('refuses a non-loopback host even when the carve-out is on', () => {
    expect(at('http://192.168.1.10:8787/')).toBe(false);
    expect(at('http://flow.example.com/')).toBe(false);
    expect(() => canonicalizeOrigin('http://flow.example.com', { allowInsecureLoopback: true }))
      .toThrow(ServerOriginError);
    expect(() => canonicalizeOrigin('http://192.168.1.10:8787', { allowInsecureLoopback: true }))
      .toThrow(ServerOriginError);
  });
});
