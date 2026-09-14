import { afterEach, describe, expect, it, vi } from 'vitest';
import { discoverServer, parseServerAddress } from './connectServer';

afterEach(() => vi.unstubAllGlobals());
describe('connection discovery boundary', () => {
  it('keeps invite and join tokens on their issuing origin', () => {
    expect(parseServerAddress('https://EXAMPLE.com:443/invite/abc')).toEqual({
      origin: 'https://example.com', inviteToken: 'abc', joinToken: undefined,
    });
    expect(parseServerAddress('https://example.com/join/team/xyz').joinToken).toBe('xyz');
  });
  it.each(['https://user:pass@example.com/invite/abc', 'https://example.com/path',
    'https://example.com/invite/abc?next=evil', 'https://example.com/#evil', 'http://example.com'])('rejects ambiguous address %s', address => {
    expect(() => parseServerAddress(address)).toThrow();
  });
  it('discovers without credentials or redirects before accepting a server', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      protocolVersion: 1, displayName: 'Trusted name', authMethods: ['password'],
      registrationAvailable: false, capabilities: {},
    })));
    vi.stubGlobal('fetch', fetcher);
    expect((await discoverServer('example.com')).origin).toBe('https://example.com');
    expect(fetcher).toHaveBeenCalledWith('https://example.com/v1/client-info', {
      credentials: 'omit', redirect: 'error', signal: undefined,
    });
  });
  it('rejects unsupported protocol versions before authentication', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"protocolVersion":2}')));
    await expect(discoverServer('example.com')).rejects.toThrow('does not support');
  });
});
