import { afterEach, expect, it, vi } from 'vitest';
import { connectSlack } from './slackConnector';
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('completes when browser isolation makes the popup appear closed and removes opener messaging', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => bytes.fill(1), subtle: { digest: async () => new ArrayBuffer(32) } });
  vi.stubGlobal('location', { origin: 'https://flow.test' });
  vi.stubGlobal('window', new EventTarget());
  let polls = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/start')
    ? { authorizationUrl: 'https://slack.com/oauth/v2/authorize', operationId: 'operation' }
    : ++polls === 1 ? { status: 'pending' } : { status: 'connected', credential: 'device-session', identity: { environment: 'slack', enterpriseId: null, teamId: 'T1', userId: 'U1' } }))));
  const popup = { closed: true, location: { href: '' }, close: vi.fn() };
  const result = connectSlack('https://connector.test', popup as unknown as Window, new AbortController().signal).catch(error => error);
  await vi.advanceTimersByTimeAsync(2000);
  expect(await result).toMatchObject({ connection: { credential: 'device-session' } });
});
